import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { DomainError, NotFoundError } from '@/lib/errors';
import { parseInput, ValidationError } from '@/lib/form-data';
import { claimRequestKey, settleRequestKey } from '@/lib/request-keys';
import { filsToString, toFils } from '@/lib/money';
import { localDateString, parseCalendarDate } from '@/lib/format';
import { addStandardAccounts, ensureChart } from '@/lib/accounting/chart';
import { bookEntry, reverseEntry, syncPosting, type PostedSource } from '@/lib/accounting/journal';

/*
 * Entries made by hand, and bringing existing records into the books.
 *
 * MANUAL ENTRIES are the accountant's: opening balances, owner's capital and
 * drawings, bank charges, depreciation, moving card takings to the bank, a
 * correction between accounts. Each must balance, use active accounts and
 * fall in an open period. Like every entry it is permanent; a mistake is
 * reversed, never edited.
 *
 * BOOKING EXISTING RECORDS runs syncPosting over everything recorded before
 * the books existed, oldest first. It is safe to run any number of times:
 * a record already booked as it stands is left alone.
 */

const MAX_LINES = 50;

const amountText = z
  .string()
  .trim()
  .refine(
    (value) => value === '' || /^\d+(\.\d{1,2})?$/.test(value),
    'Enter an amount like 250 or 250.50.',
  );

const lineSchema = z.object({
  accountId: z.uuid({ error: 'Choose an account for every line.' }),
  debit: amountText.optional(),
  credit: amountText.optional(),
  memo: z.string().trim().max(200).optional(),
});

const manualSchema = z.object({
  date: z.string({ error: 'Choose the date.' }).min(1, 'Choose the date.'),
  description: z
    .string({ error: 'Describe the entry.' })
    .trim()
    .min(3, 'Describe the entry.')
    .max(300, 'Keep the description under 300 characters.'),
  lines: z
    .array(lineSchema)
    .min(2, 'An entry needs at least two lines.')
    .max(MAX_LINES, `An entry can have at most ${MAX_LINES} lines.`),
  requestKey: z.string().optional(),
});

/** Books an entry made by hand. */
export async function createManualEntry(user: AuthenticatedUser, rawInput: unknown) {
  requirePermission(user, 'accounting.create');
  const input = parseInput(manualSchema, rawInput);
  const date = parseCalendarDate(input.date);
  if (!date) throw new DomainError('Choose a valid date.', 'date');
  if (input.date > localDateString()) {
    throw new DomainError('An entry can’t be dated in the future.', 'date');
  }

  const errors: Record<string, string> = {};
  const lines = input.lines.map((line, index) => {
    const debit = line.debit ? toFils(line.debit) : 0;
    const credit = line.credit ? toFils(line.credit) : 0;
    if ((debit === 0) === (credit === 0)) {
      errors[`lines.${index}`] = `Line ${index + 1}: enter a debit or a credit — one, not both.`;
    }
    return { accountId: line.accountId, debit, credit, memo: line.memo || null };
  });
  if (Object.keys(errors).length) throw new ValidationError(errors);
  const debits = lines.reduce((sum, line) => sum + line.debit, 0);
  const credits = lines.reduce((sum, line) => sum + line.credit, 0);
  if (debits !== credits) {
    throw new DomainError(
      `The entry does not balance: debits ${filsToString(debits)}, credits ${filsToString(credits)} (difference ${filsToString(Math.abs(debits - credits))}).`,
      'lines',
    );
  }

  return prisma.$transaction(async (tx) => {
    await claimRequestKey(tx, user, rawInput, 'journal.create');
    await ensureChart(tx, user.organizationId);
    const accounts = await tx.chartOfAccount.findMany({
      where: {
        organizationId: user.organizationId,
        id: { in: lines.map((line) => line.accountId) },
      },
      select: { id: true, isActive: true, accountName: true },
    });
    const known = new Map(accounts.map((account) => [account.id, account]));
    lines.forEach((line, index) => {
      const account = known.get(line.accountId);
      if (!account)
        throw new DomainError(`Line ${index + 1}: that account was not found.`, `lines.${index}`);
      if (!account.isActive) {
        throw new DomainError(
          `Line ${index + 1}: “${account.accountName}” is retired. Choose an active account.`,
          `lines.${index}`,
        );
      }
    });

    const entry = await bookEntry(tx, {
      organizationId: user.organizationId,
      branchId: null,
      date,
      description: input.description,
      lines,
      sourceType: 'MANUAL',
      sourceId: null,
      actorUserId: user.id,
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: 'journal.created',
      entityType: 'JournalEntry',
      entityId: entry.id,
      afterData: {
        entryNumber: entry.entryNumber,
        date: input.date,
        description: input.description,
        total: filsToString(debits),
        lines: lines.map((line) => ({
          accountId: line.accountId,
          debit: filsToString(line.debit),
          credit: filsToString(line.credit),
        })),
      },
    });
    await settleRequestKey(tx, user, rawInput, entry.id);
    return entry;
  });
}

const reverseSchema = z.object({
  date: z.string({ error: 'Choose the date.' }).min(1, 'Choose the date.'),
  reason: z.string({ error: 'Say why.' }).trim().min(3, 'Say why, in a few words.').max(300),
});

/**
 * Reverses an entry made by hand. Entries booked from a record (an invoice,
 * a payment…) are corrected through that record instead, so the two can
 * never disagree.
 */
export async function reverseManualEntry(
  user: AuthenticatedUser,
  entryId: string,
  rawInput: unknown,
) {
  requirePermission(user, 'accounting.delete');
  const input = parseInput(reverseSchema, rawInput);
  const date = parseCalendarDate(input.date);
  if (!date) throw new DomainError('Choose a valid date.', 'date');

  return prisma.$transaction(async (tx) => {
    const entry = await tx.journalEntry.findFirst({
      where: { id: entryId, organizationId: user.organizationId },
      include: {
        lines: { select: { chartOfAccountId: true, debitAmount: true, creditAmount: true } },
        reversals: { select: { entryNumber: true } },
      },
    });
    if (!entry) throw new NotFoundError('journal entry');
    if (entry.sourceType !== 'MANUAL') {
      throw new DomainError(
        'This entry was booked from a record. Correct or void the record itself and the books follow.',
      );
    }
    if (entry.reversalOfJournalEntryId) throw new DomainError('This entry is itself a reversal.');
    if (entry.reversals.length > 0) {
      throw new DomainError(
        `Already reversed by ${entry.reversals[0].entryNumber ?? 'another entry'}.`,
      );
    }
    if (date.getTime() < entry.entryDate.getTime()) {
      throw new DomainError('A reversal can’t be dated before the entry it reverses.', 'date');
    }
    const reversal = await reverseEntry(tx, entry, date, user.id, input.reason);
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: 'journal.reversed',
      entityType: 'JournalEntry',
      entityId: entry.id,
      afterData: { reversedBy: reversal.entryNumber, date: input.date },
      metadata: { reason: input.reason },
    });
    return reversal;
  });
}

// ─── The standard chart ─────────────────────────────────────────────────────

/**
 * Adds every standard account the workshop doesn't have yet (by code and by
 * name), and the system accounts if any are missing. Never renames or
 * removes an account.
 */
export async function completeStandardChart(user: AuthenticatedUser) {
  requirePermission(user, 'accounting.create');
  return prisma.$transaction(async (tx) => {
    await ensureChart(tx, user.organizationId);
    const added = await addStandardAccounts(tx, user.organizationId);
    if (added > 0) {
      await writeAuditLog(tx, {
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: 'accounts.standard_added',
        entityType: 'Organization',
        entityId: user.organizationId,
        afterData: { added },
      });
    }
    return { added };
  });
}

// ─── Records not yet in the books ───────────────────────────────────────────

/** Stock movements that change the value of stock, and so are booked. */
const VALUED_MOVEMENTS = [
  'PURCHASE_RECEIPT',
  'RETURN_TO_SUPPLIER',
  'OPENING_STOCK',
  'ADJUSTMENT',
] as const;

/** Records whose postings are found by source rather than a link on the record. */
const LATER_SOURCES = [
  'CREDIT_NOTE',
  'CREDIT_NOTE_REFUND',
  'FIXED_ASSET',
  'DEPRECIATION',
  'ASSET_DISPOSAL',
  'MONEY_TRANSFER',
  'CUSTOMER_ADVANCE',
  'CUSTOMER_ADVANCE_ALLOCATION',
  'CUSTOMER_ADVANCE_REFUND',
  'INVOICE_DISCOUNT',
  'PURCHASE_ROUNDING',
  'OWNER_MONEY',
] as const;

/** What is waiting to be booked, oldest first, by kind of record. */
async function unbooked(organizationId: string) {
  const [
    invoices,
    payments,
    expenses,
    supplierPayments,
    movements,
    bookedMovements,
    payrolls,
    bookedPayrollPayments,
    vatFilings,
    bookedVat,
    creditNotes,
    assets,
    depreciations,
    bookedOther,
    reimbursements,
    transfers,
    advances,
    allocations,
    advanceRefunds,
    discountedInvoices,
    roundedPurchases,
    ownerMoney,
  ] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        organizationId,
        invoiceType: { in: ['TAX_INVOICE', 'OPENING_BALANCE'] },
        status: { notIn: ['DRAFT', 'VOID', 'CANCELLED'] },
        journalEntryId: null,
      },
      orderBy: [{ issueDate: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    }),
    prisma.payment.findMany({
      where: { organizationId, journalEntryId: null },
      orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    }),
    prisma.expense.findMany({
      where: { organizationId, status: 'RECORDED', journalEntryId: null },
      orderBy: [{ expenseDate: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    }),
    prisma.supplierPayment.findMany({
      where: { organizationId, journalEntryId: null },
      orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    }),
    prisma.inventoryTransaction.findMany({
      where: {
        organizationId,
        transactionType: { in: [...VALUED_MOVEMENTS] },
        unitCost: { not: null },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    }),
    prisma.journalEntry.findMany({
      where: { organizationId, sourceType: 'STOCK_MOVEMENT' },
      select: { sourceId: true },
    }),
    prisma.payroll.findMany({
      where: { organizationId, status: { in: ['APPROVED', 'PAID'] } },
      orderBy: [{ periodEnd: 'asc' }],
      select: { id: true, status: true, journalEntryId: true },
    }),
    prisma.journalEntry.findMany({
      where: { organizationId, sourceType: 'PAYROLL_PAYMENT' },
      select: { sourceId: true },
    }),
    prisma.vatFiling.findMany({
      where: { organizationId },
      orderBy: [{ periodTo: 'asc' }],
      select: { id: true, settledOn: true },
    }),
    prisma.journalEntry.findMany({
      where: { organizationId, sourceType: { in: ['VAT_FILING', 'VAT_PAYMENT'] } },
      select: { sourceType: true, sourceId: true },
    }),
    prisma.creditNote.findMany({
      where: { organizationId, status: 'ISSUED' },
      orderBy: [{ issueDate: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, refundedOn: true },
    }),
    prisma.fixedAsset.findMany({
      where: { organizationId },
      orderBy: [{ acquiredOn: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, status: true },
    }),
    prisma.assetDepreciation.findMany({
      where: { organizationId },
      orderBy: [{ periodEnd: 'asc' }],
      select: { id: true },
    }),
    prisma.journalEntry.findMany({
      where: { organizationId, sourceType: { in: [...LATER_SOURCES] } },
      select: { sourceType: true, sourceId: true },
    }),
    prisma.ownerReimbursement.findMany({
      where: { organizationId, journalEntryId: null },
      orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    }),
    prisma.moneyTransfer.findMany({
      where: { organizationId, status: 'POSTED' },
      orderBy: [{ transferredOn: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    }),
    prisma.customerAdvance.findMany({
      where: { organizationId, status: { not: 'CANCELLED' } },
      orderBy: [{ receivedOn: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    }),
    prisma.customerAdvanceAllocation.findMany({
      where: { organizationId, reversedAt: null },
      orderBy: [{ allocatedOn: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    }),
    prisma.customerAdvanceRefund.findMany({
      where: { organizationId, reversedAt: null },
      orderBy: [{ refundedOn: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    }),
    prisma.invoice.findMany({
      where: {
        organizationId,
        settlementDiscountOn: { not: null },
        status: { notIn: ['DRAFT', 'VOID', 'CANCELLED'] },
      },
      orderBy: [{ settlementDiscountOn: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    }),
    prisma.purchase.findMany({
      where: { organizationId, status: 'RECEIVED', roundingAdjustment: { not: 0 } },
      orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    }),
    prisma.ownerMoney.findMany({
      where: { organizationId, status: 'POSTED' },
      orderBy: [{ movedOn: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    }),
  ]);
  const booked = new Set(bookedMovements.map((entry) => entry.sourceId));
  const paidBooked = new Set(bookedPayrollPayments.map((entry) => entry.sourceId));
  const vatBooked = (source: string) =>
    new Set(
      bookedVat.filter((entry) => entry.sourceType === source).map((entry) => entry.sourceId),
    );
  const notBooked = (rows: { id: string }[], source: (typeof LATER_SOURCES)[number]) => {
    const done = new Set(
      bookedOther.filter((entry) => entry.sourceType === source).map((entry) => entry.sourceId),
    );
    return rows.filter((row) => !done.has(row.id)).map((row) => row.id);
  };
  const filedBooked = vatBooked('VAT_FILING');
  const settledBooked = vatBooked('VAT_PAYMENT');
  return {
    INVOICE: invoices.map((row) => row.id),
    PAYMENT: payments.map((row) => row.id),
    EXPENSE: expenses.map((row) => row.id),
    SUPPLIER_PAYMENT: supplierPayments.map((row) => row.id),
    STOCK_MOVEMENT: movements.filter((row) => !booked.has(row.id)).map((row) => row.id),
    PAYROLL: payrolls.filter((run) => !run.journalEntryId).map((run) => run.id),
    PAYROLL_PAYMENT: payrolls
      .filter((run) => run.status === 'PAID' && !paidBooked.has(run.id))
      .map((run) => run.id),
    VAT_FILING: vatFilings.filter((f) => !filedBooked.has(f.id)).map((f) => f.id),
    VAT_PAYMENT: vatFilings.filter((f) => f.settledOn && !settledBooked.has(f.id)).map((f) => f.id),
    CREDIT_NOTE: notBooked(creditNotes, 'CREDIT_NOTE'),
    CREDIT_NOTE_REFUND: notBooked(
      creditNotes.filter((note) => note.refundedOn),
      'CREDIT_NOTE_REFUND',
    ),
    FIXED_ASSET: notBooked(assets, 'FIXED_ASSET'),
    DEPRECIATION: notBooked(depreciations, 'DEPRECIATION'),
    ASSET_DISPOSAL: notBooked(
      assets.filter((asset) => asset.status === 'DISPOSED'),
      'ASSET_DISPOSAL',
    ),
    OWNER_REIMBURSEMENT: reimbursements.map((row) => row.id),
    MONEY_TRANSFER: notBooked(transfers, 'MONEY_TRANSFER'),
    CUSTOMER_ADVANCE: notBooked(advances, 'CUSTOMER_ADVANCE'),
    CUSTOMER_ADVANCE_ALLOCATION: notBooked(allocations, 'CUSTOMER_ADVANCE_ALLOCATION'),
    CUSTOMER_ADVANCE_REFUND: notBooked(advanceRefunds, 'CUSTOMER_ADVANCE_REFUND'),
    INVOICE_DISCOUNT: notBooked(discountedInvoices, 'INVOICE_DISCOUNT'),
    PURCHASE_ROUNDING: notBooked(roundedPurchases, 'PURCHASE_ROUNDING'),
    OWNER_MONEY: notBooked(ownerMoney, 'OWNER_MONEY'),
  } satisfies Record<PostedSource, string[]>;
}

/** How many records are not yet in the books, for the accounting screen. */
export async function countUnbooked(user: AuthenticatedUser) {
  requirePermission(user, 'accounting.view');
  const waiting = await unbooked(user.organizationId);
  return Object.values(waiting).reduce((sum, ids) => sum + ids.length, 0);
}

/**
 * Books everything recorded before the books existed (or missed since),
 * oldest first — stock and invoices before the payments against them. One
 * transaction per record, so a record that can't be booked (dated in a
 * closed period) is reported without undoing the rest.
 */
export async function bookExistingRecords(user: AuthenticatedUser) {
  requirePermission(user, 'accounting.approve');
  const waiting = await unbooked(user.organizationId);
  const order: PostedSource[] = [
    'STOCK_MOVEMENT',
    'INVOICE',
    'PAYMENT',
    'EXPENSE',
    'SUPPLIER_PAYMENT',
    'PAYROLL',
    'PAYROLL_PAYMENT',
    'CREDIT_NOTE',
    'CREDIT_NOTE_REFUND',
    'FIXED_ASSET',
    'DEPRECIATION',
    'ASSET_DISPOSAL',
    'VAT_FILING',
    'VAT_PAYMENT',
    'OWNER_REIMBURSEMENT',
    'MONEY_TRANSFER',
    'CUSTOMER_ADVANCE',
    'CUSTOMER_ADVANCE_ALLOCATION',
    'CUSTOMER_ADVANCE_REFUND',
    'INVOICE_DISCOUNT',
    'PURCHASE_ROUNDING',
    'OWNER_MONEY',
  ];
  let booked = 0;
  const failed: string[] = [];
  for (const source of order) {
    for (const id of waiting[source]) {
      try {
        const changed = await prisma.$transaction((tx) =>
          syncPosting(tx, user.organizationId, source, id, user.id),
        );
        if (changed) booked += 1;
      } catch (error) {
        failed.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  await writeAuditLog(prisma, {
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: 'books.backfilled',
    entityType: 'Organization',
    entityId: user.organizationId,
    afterData: { booked, failed: failed.length },
  });
  return { booked, failed };
}
