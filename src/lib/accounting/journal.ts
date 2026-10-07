import type { Prisma } from '@/generated/prisma/client';
import type { JournalSource } from '@/generated/prisma/enums';
import { allocateDocumentNumber } from '@/lib/numbering';
import { filsToString, toFils } from '@/lib/money';
import { ensureChart } from '@/lib/accounting/chart';
import { txMemo } from '@/lib/tx-memo';
import { assertBooksOpen } from '@/lib/accounting/periods';
import { POSTING_RULES, type Posting, type PostingLine } from '@/lib/accounting/postings';

/*
 * Booking to the general ledger.
 *
 * A journal entry is permanent (the database refuses to change or delete
 * one, and refuses one whose debits and credits differ). A booking that
 * turns out wrong is corrected the way an accountant would: a reversing
 * entry cancels it, and a new entry books it right.
 *
 * syncPosting() is how every record reaches the books. Called in the same
 * transaction as any change to an invoice, payment, expense, stock movement
 * or supplier payment, it works out the entry the record now calls for
 * (lib/accounting/postings.ts), compares it with what is booked, and — only
 * if they differ — reverses the old entry and books the new one, both dated
 * on the record's own date. Because it compares rather than assumes, calling
 * it again changes nothing, and it can be run over every record to book
 * what was recorded before the books existed.
 */

type Tx = Prisma.TransactionClient;

/**
 * Sources booked from a record through its posting rule. Manual, opening
 * balance and year-end closing entries are booked directly instead.
 */
export type PostedSource = Exclude<JournalSource, 'MANUAL' | 'OPENING_BALANCE' | 'YEAR_END_CLOSE'>;

interface EntryInput {
  organizationId: string;
  branchId: string | null;
  date: Date;
  description: string;
  lines: PostingLine[];
  sourceType: JournalSource;
  sourceId: string | null;
  reversalOfId?: string;
  actorUserId: string;
  /**
   * Book into a closed period. Only a year-end closing entry (and its
   * reversal) may: it is dated on the last day of the year it closes, which
   * is normally already closed by then.
   */
  allowClosedPeriod?: boolean;
}

/**
 * The next free JV- number. Every booking in the app — an invoice, a
 * receipt, an expense, a stock movement — needs one, so a counter that has
 * fallen behind numbers already in the books (written by an import or a
 * repair outside the normal path) would stop all of them with a duplicate
 * error. If the number handed out is already used, the counter is moved past
 * the highest number in the books and the next one is taken instead.
 */
async function nextEntryNumber(tx: Tx, organizationId: string): Promise<string> {
  const entryNumber = await allocateDocumentNumber(tx, organizationId, null, 'JOURNAL_ENTRY');
  const taken = await tx.journalEntry.findFirst({
    where: { organizationId, entryNumber },
    select: { id: true },
  });
  if (!taken) return entryNumber;

  const prefix = entryNumber.replace(/\d+$/, '');
  const [{ highest }] = await tx.$queryRaw<{ highest: number | null }[]>`
    SELECT max(substring(entry_number FROM ${prefix.length + 1})::int) AS highest
    FROM journal_entries
    WHERE organization_id = ${organizationId}::uuid
      AND entry_number LIKE ${`${prefix}%`}
      AND substring(entry_number FROM ${prefix.length + 1}) ~ '^[0-9]+$'`;
  await tx.$executeRaw`
    UPDATE document_number_sequences
    SET next_number = GREATEST(next_number, ${Number(highest ?? 0) + 1}), updated_at = now()
    WHERE organization_id = ${organizationId}::uuid
      AND document_type = 'JOURNAL_ENTRY'::"DocumentType"
      AND branch_id IS NULL`;
  console.warn(
    `Journal numbering was behind (${entryNumber} already used); moved past ${prefix}${highest}.`,
  );
  return allocateDocumentNumber(tx, organizationId, null, 'JOURNAL_ENTRY');
}

/** Books one entry, numbered JV-…, inside the caller's transaction. */
export async function bookEntry(tx: Tx, input: EntryInput) {
  if (!input.allowClosedPeriod) await assertBooksOpen(tx, input.organizationId, input.date);
  const entryNumber = await nextEntryNumber(tx, input.organizationId);
  const now = new Date();
  const entry = await tx.journalEntry.create({
    data: {
      organizationId: input.organizationId,
      branchId: input.branchId,
      entryNumber,
      entryDate: input.date,
      description: input.description.slice(0, 500),
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      reversalOfJournalEntryId: input.reversalOfId ?? null,
      isPosted: true,
      postedAt: now,
      postedByUserId: input.actorUserId,
      createdByUserId: input.actorUserId,
    },
  });
  await tx.journalEntryLine.createMany({
    data: input.lines.map((line) => ({
      organizationId: input.organizationId,
      journalEntryId: entry.id,
      chartOfAccountId: line.accountId,
      debitAmount: filsToString(line.debit),
      creditAmount: filsToString(line.credit),
      description: line.memo ?? null,
      customerId: line.customerId ?? null,
      supplierId: line.supplierId ?? null,
    })),
  });
  return entry;
}

/** The entry currently standing for a record: booked, and not since reversed. */
async function standingEntry(
  tx: Tx,
  organizationId: string,
  source: JournalSource,
  sourceId: string,
) {
  return tx.journalEntry.findFirst({
    where: {
      organizationId,
      sourceType: source,
      sourceId,
      reversalOfJournalEntryId: null,
      reversals: { none: {} },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: {
      lines: { select: { chartOfAccountId: true, debitAmount: true, creditAmount: true } },
    },
  });
}

/**
 * Cancels an entry with an equal and opposite one, dated `date`. The original
 * stays on record, linked to its reversal.
 */
export async function reverseEntry(
  tx: Tx,
  entry: {
    id: string;
    organizationId: string;
    branchId: string | null;
    entryNumber: string | null;
    description: string | null;
    sourceType: JournalSource;
    sourceId: string | null;
    lines: {
      chartOfAccountId: string;
      debitAmount: { toString(): string };
      creditAmount: { toString(): string };
      customerId?: string | null;
      supplierId?: string | null;
    }[];
  },
  date: Date,
  actorUserId: string,
  reason: string,
  options: { allowClosedPeriod?: boolean } = {},
) {
  return bookEntry(tx, {
    allowClosedPeriod: options.allowClosedPeriod,
    organizationId: entry.organizationId,
    branchId: entry.branchId,
    date,
    description: `Reversal of ${entry.entryNumber ?? 'entry'}: ${reason}`,
    lines: entry.lines.map((line) => ({
      accountId: line.chartOfAccountId,
      debit: toFils(line.creditAmount.toString()),
      credit: toFils(line.debitAmount.toString()),
      // The same customer or supplier, so their balance is put back too.
      customerId: line.customerId ?? null,
      supplierId: line.supplierId ?? null,
    })),
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    reversalOfId: entry.id,
    actorUserId,
  });
}

/** Lines in one comparable form: sorted, as text. */
function signature(date: Date, lines: { accountId: string; debit: number; credit: number }[]) {
  const sorted = [...lines]
    .map((line) => `${line.accountId}:${line.debit}:${line.credit}`)
    .sort()
    .join('|');
  return `${date.toISOString().slice(0, 10)}#${sorted}`;
}

/** Records that point at the entry currently booking them. */
const DOCUMENT_LINK: Partial<
  Record<PostedSource, (tx: Tx, id: string, journalEntryId: string | null) => Promise<unknown>>
> = {
  INVOICE: (tx, id, journalEntryId) =>
    tx.invoice.update({ where: { id }, data: { journalEntryId } }),
  PAYMENT: (tx, id, journalEntryId) =>
    tx.payment.update({ where: { id }, data: { journalEntryId } }),
  EXPENSE: (tx, id, journalEntryId) =>
    tx.expense.update({ where: { id }, data: { journalEntryId } }),
  SUPPLIER_PAYMENT: (tx, id, journalEntryId) =>
    tx.supplierPayment.update({ where: { id }, data: { journalEntryId } }),
  PAYROLL: (tx, id, journalEntryId) =>
    tx.payroll.update({ where: { id }, data: { journalEntryId } }),
  OWNER_REIMBURSEMENT: (tx, id, journalEntryId) =>
    tx.ownerReimbursement.update({ where: { id }, data: { journalEntryId } }),
};

/**
 * Brings one record's booking up to date: books it if it isn't, re-books it
 * if it changed, reverses it if it no longer counts (a void invoice). Returns
 * whether anything was booked.
 */
export async function syncPosting(
  tx: Tx,
  organizationId: string,
  source: PostedSource,
  sourceId: string,
  actorUserId: string,
): Promise<boolean> {
  // One delivery books an entry per line: the chart is read once for them all.
  const accounts = await txMemo(tx, `chart:${organizationId}`, () =>
    ensureChart(tx, organizationId),
  );
  const wanted: Posting | null = await POSTING_RULES[source](
    tx,
    organizationId,
    sourceId,
    accounts,
  );
  const standing = await standingEntry(tx, organizationId, source, sourceId);

  const standingSignature = standing
    ? signature(
        standing.entryDate,
        standing.lines.map((line) => ({
          accountId: line.chartOfAccountId,
          debit: toFils(line.debitAmount.toString()),
          credit: toFils(line.creditAmount.toString()),
        })),
      )
    : null;
  const wantedSignature =
    wanted && wanted.lines.length > 0 ? signature(wanted.date, wanted.lines) : null;
  if (standingSignature === wantedSignature) return false;

  if (standing) {
    await reverseEntry(
      tx,
      standing,
      standing.entryDate,
      actorUserId,
      wantedSignature ? 'corrected' : 'no longer counts',
    );
  }
  let booked: { id: string } | null = null;
  if (wanted && wantedSignature) {
    booked = await bookEntry(tx, {
      organizationId,
      branchId: wanted.branchId,
      date: wanted.date,
      description: wanted.description,
      lines: wanted.lines,
      sourceType: source,
      sourceId,
      actorUserId,
    });
  }
  await DOCUMENT_LINK[source]?.(tx, sourceId, booked?.id ?? null);
  return true;
}
