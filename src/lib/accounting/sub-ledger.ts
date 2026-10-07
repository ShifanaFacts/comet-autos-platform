import type { AccountRole, PartyType, Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { toFils } from '@/lib/money';

/*
 * Customer and supplier sub-ledgers in the journal.
 *
 * An account is kept per party when it is trade receivables (customers) or
 * trade payables (suppliers), or when the accountant set its sub-ledger.
 * Documents — invoices, payments, purchases, supplier payments — are kept per
 * party by the document itself; a journal entry made by hand names the
 * customer or supplier on each line instead. A party's balance is its
 * documents plus these lines, so the parties still add up to the account.
 * (The database enforces the same rule: migration 20261019090000.)
 */

/** Who an account is kept by: its own setting, else what its system role implies. */
export function subLedgerOf(account: {
  role: AccountRole | null;
  subLedger: PartyType | null;
}): PartyType | null {
  if (account.subLedger) return account.subLedger;
  if (account.role === 'ACCOUNTS_RECEIVABLE') return 'CUSTOMER';
  if (account.role === 'ACCOUNTS_PAYABLE') return 'SUPPLIER';
  return null;
}

/** Trade receivables and payables are always kept per party; their setting can't change. */
export const fixedSubLedger = (role: AccountRole | null) =>
  role === 'ACCOUNTS_RECEIVABLE' || role === 'ACCOUNTS_PAYABLE';

type Client = Prisma.TransactionClient | typeof prisma;

const lineSelect = {
  id: true,
  debitAmount: true,
  creditAmount: true,
  description: true,
  customerId: true,
  supplierId: true,
  customer: { select: { id: true, name: true, phone: true } },
  supplier: { select: { id: true, name: true, phone: true } },
  chartOfAccount: { select: { accountCode: true, accountName: true } },
  journalEntry: {
    select: { id: true, entryNumber: true, entryDate: true, description: true },
  },
} as const;

/**
 * The journal lines naming parties: one customer's or supplier's, or every
 * party's when no id is given.
 */
export async function partyJournalLines(
  client: Client,
  organizationId: string,
  party: { kind: 'customer' | 'supplier'; ids?: string | string[] },
) {
  const match =
    party.ids === undefined
      ? { not: null }
      : Array.isArray(party.ids)
        ? { in: party.ids }
        : party.ids;
  const filter = party.kind === 'customer' ? { customerId: match } : { supplierId: match };
  const lines = await client.journalEntryLine.findMany({
    where: { organizationId, ...filter },
    orderBy: [{ journalEntry: { entryDate: 'asc' } }, { createdAt: 'asc' }],
    select: lineSelect,
  });
  return lines.map((line) => {
    const debit = toFils(line.debitAmount.toString());
    const credit = toFils(line.creditAmount.toString());
    return {
      ...line,
      /** What it adds to the customer's debt (debit) — negative when it reduces it. */
      customerFils: debit - credit,
      /** What it adds to what is owed to the supplier (credit) — negative when it reduces it. */
      supplierFils: credit - debit,
    };
  });
}

export type PartyJournalLine = Awaited<ReturnType<typeof partyJournalLines>>[number];

/** Each customer's net journal amount: what manual entries add to what they owe. */
export async function customerJournalTotals(
  client: Client,
  organizationId: string,
  customerIds?: string[],
) {
  const totals = new Map<string, number>();
  for (const line of await partyJournalLines(client, organizationId, {
    kind: 'customer',
    ids: customerIds,
  })) {
    totals.set(line.customerId!, (totals.get(line.customerId!) ?? 0) + line.customerFils);
  }
  return totals;
}

/** Each supplier's net journal amount: what manual entries add to what is owed to them. */
export async function supplierJournalTotals(
  client: Client,
  organizationId: string,
  supplierIds?: string[],
) {
  const totals = new Map<string, number>();
  for (const line of await partyJournalLines(client, organizationId, {
    kind: 'supplier',
    ids: supplierIds,
  })) {
    totals.set(line.supplierId!, (totals.get(line.supplierId!) ?? 0) + line.supplierFils);
  }
  return totals;
}
