import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import type { PaymentMethod } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { DomainError, NotFoundError } from '@/lib/errors';
import { claimRequestKey, settleRequestKey } from '@/lib/request-keys';
import { parseInput } from '@/lib/form-data';
import { emptyToNull } from '@/lib/normalize';
import { localDateString, parseCalendarDate } from '@/lib/format';
import { filsToString, toFils } from '@/lib/money';
import { syncPosting } from '@/lib/accounting/journal';
import { checkMoneyAccount, refuseCardSettlementAccount } from '@/lib/accounting/chart';

/*
 * Business costs an owner paid with their own money, and paying them back.
 *
 * The managing partner pays a supplier with his own card: the expense is
 * the workshop's, but the money was his, so the workshop owes it to him —
 * "Due to owner (current account)", a liability, not a bank payment. When
 * the workshop repays him, that liability goes down and cash or bank with it.
 *
 * Who can pay personally: active users holding the Owner role (the built-in
 * system role). Partners will be added here when they exist.
 *
 * What is owed to each person is worked out from the records — their
 * personally-paid expenses still recorded, less repayments that stand — so
 * it can be listed line by line. A repayment that turns out wrong is
 * reversed the way a supplier payment is: the original stays, marked
 * REVERSED, and a linked reversal row undoes it; neither counts after that.
 */

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof prisma;

const PAYMENT_METHODS = ['CASH', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'ONLINE'] as const;
const ACTIVE_GRANT = { revokedAt: null } as const;

/** Active users holding the Owner role: who can pay a business cost personally. */
export async function listPersonalPayers(organizationId: string, client: Client = prisma) {
  return client.user.findMany({
    where: {
      organizationId,
      isActive: true,
      userRoles: { some: { ...ACTIVE_GRANT, role: { isSystem: true } } },
    },
    orderBy: { fullName: 'asc' },
    select: { id: true, fullName: true },
  });
}

/** The person named, checked to be one who can pay personally. */
export async function resolvePersonalPayer(tx: Tx, organizationId: string, userId: string) {
  const payer = (await listPersonalPayers(organizationId, tx)).find((row) => row.id === userId);
  if (!payer) {
    throw new DomainError('Choose an owner from the list.', 'paymentMethod');
  }
  return payer;
}

// ─── What is owed ───────────────────────────────────────────────────────────

/** Repayments that count: completed, not a reversal, never reversed. */
const STANDING = {
  status: 'COMPLETED' as const,
  reversalOfId: null,
  reversals: { none: {} },
};

async function owedFils(tx: Tx, organizationId: string, personUserId: string) {
  const [expenses, repaid] = await Promise.all([
    tx.expense.findMany({
      where: { organizationId, paidByUserId: personUserId, status: 'RECORDED' },
      select: { amount: true, taxAmount: true },
    }),
    tx.ownerReimbursement.aggregate({
      where: { organizationId, personUserId, ...STANDING },
      _sum: { amount: true },
    }),
  ]);
  const paid = expenses.reduce(
    (sum, row) =>
      sum + toFils(row.amount.toString()) + (row.taxAmount ? toFils(row.taxAmount.toString()) : 0),
    0,
  );
  return paid - toFils(repaid._sum.amount?.toString() ?? '0');
}

export interface OwedLine {
  kind: 'expense' | 'repayment';
  id: string;
  /** YYYY-MM-DD */
  date: string;
  description: string;
  supplier: string | null;
  billNumber: string | null;
  /** Positive: owed to them; negative: paid back. */
  amount: string;
  balance: string;
  href: string | null;
  /** A repayment that can still be reversed. */
  reversible: boolean;
  method: PaymentMethod | null;
  /** A repayment's transfer or cheque reference. */
  reference: string | null;
}

/**
 * Per person, every business cost they paid personally and every repayment,
 * newest first, each with the balance owed to them after it.
 */
export async function getOwedToOwners(user: AuthenticatedUser) {
  requirePermission(user, 'accounting.view');
  const organizationId = user.organizationId;
  const [expenses, repayments, payers] = await Promise.all([
    prisma.expense.findMany({
      where: { organizationId, paidByUserId: { not: null }, status: 'RECORDED' },
      orderBy: [{ expenseDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        expenseNumber: true,
        description: true,
        vendorName: true,
        billNumber: true,
        amount: true,
        taxAmount: true,
        expenseDate: true,
        createdAt: true,
        paidByUserId: true,
      },
    }),
    prisma.ownerReimbursement.findMany({
      where: { organizationId, ...STANDING },
      orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        amount: true,
        method: true,
        note: true,
        reference: true,
        paidOn: true,
        createdAt: true,
        personUserId: true,
      },
    }),
    listPersonalPayers(organizationId),
  ]);

  const people = new Map<
    string,
    { id: string; name: string; rows: (OwedLine & { fils: number; order: string })[] }
  >();
  const personOf = async (id: string) => {
    if (!people.has(id)) {
      const known = payers.find((payer) => payer.id === id);
      const name =
        known?.fullName ??
        (await prisma.user.findFirst({ where: { id, organizationId }, select: { fullName: true } }))
          ?.fullName ??
        'Unknown';
      people.set(id, { id, name, rows: [] });
    }
    return people.get(id)!;
  };

  for (const expense of expenses) {
    const fils =
      toFils(expense.amount.toString()) +
      (expense.taxAmount ? toFils(expense.taxAmount.toString()) : 0);
    const date = expense.expenseDate.toISOString().slice(0, 10);
    (await personOf(expense.paidByUserId!)).rows.push({
      kind: 'expense',
      id: expense.id,
      date,
      order: `${date}:${expense.createdAt.toISOString()}`,
      description: expense.description,
      supplier: expense.vendorName,
      billNumber: expense.billNumber,
      amount: filsToString(fils),
      fils,
      balance: '0.00',
      href: expense.expenseNumber
        ? `/finance/expenses?q=${encodeURIComponent(expense.expenseNumber)}`
        : '/finance/expenses',
      reversible: false,
      method: null,
      reference: null,
    });
  }
  for (const repayment of repayments) {
    const fils = -toFils(repayment.amount.toString());
    const date = repayment.paidOn.toISOString().slice(0, 10);
    (await personOf(repayment.personUserId)).rows.push({
      kind: 'repayment',
      id: repayment.id,
      date,
      order: `${date}:${repayment.createdAt.toISOString()}`,
      description: repayment.note ? `Reimbursed — ${repayment.note}` : 'Reimbursed',
      supplier: null,
      billNumber: null,
      amount: filsToString(fils),
      fils,
      balance: '0.00',
      href: null,
      reversible: true,
      method: repayment.method,
      reference: repayment.reference,
    });
  }

  const result = [...people.values()].map((person) => {
    const rows = person.rows.sort((a, b) => a.order.localeCompare(b.order));
    let running = 0;
    const lines: OwedLine[] = rows.map(({ fils, order: _order, ...row }) => {
      void _order;
      running += fils;
      return { ...row, balance: filsToString(running) };
    });
    // The balance runs oldest to newest; the list reads newest first.
    return {
      id: person.id,
      name: person.name,
      owed: filsToString(running),
      lines: lines.reverse(),
    };
  });
  // Everyone who can pay personally is listed, owed or not, so a first
  // repayment has somewhere to start.
  for (const payer of payers) {
    if (!result.some((row) => row.id === payer.id)) {
      result.push({ id: payer.id, name: payer.fullName, owed: '0.00', lines: [] });
    }
  }
  result.sort((a, b) => a.name.localeCompare(b.name));
  return {
    people: result,
    total: filsToString(result.reduce((sum, row) => sum + toFils(row.owed), 0)),
  };
}

export type OwedToOwners = Awaited<ReturnType<typeof getOwedToOwners>>;

/**
 * What the workshop owes its owners in all, for the dashboards' "Owed to
 * owner" line. The caller decides who may see it.
 */
export async function getOwedToOwnersTotal(organizationId: string) {
  const [expenses, repaid] = await Promise.all([
    prisma.expense.findMany({
      where: { organizationId, paidByUserId: { not: null }, status: 'RECORDED' },
      select: { amount: true, taxAmount: true },
    }),
    prisma.ownerReimbursement.aggregate({
      where: { organizationId, ...STANDING },
      _sum: { amount: true },
    }),
  ]);
  const paid = expenses.reduce(
    (sum, row) =>
      sum + toFils(row.amount.toString()) + (row.taxAmount ? toFils(row.taxAmount.toString()) : 0),
    0,
  );
  return filsToString(paid - toFils(repaid._sum.amount?.toString() ?? '0'));
}

// ─── Repaying ───────────────────────────────────────────────────────────────

const reimburseSchema = z.object({
  amount: z
    .string({ error: 'Enter the amount repaid.' })
    .trim()
    .refine(
      (value) => /^\d+(\.\d{1,2})?$/.test(value) && Number(value) > 0,
      'Enter an amount like 250 or 250.50.',
    ),
  method: z.enum(PAYMENT_METHODS, { error: 'Choose how they were repaid.' }),
  /** The cash or bank account it was paid from; blank for the method's default. */
  accountId: z.union([z.literal(''), z.uuid()]).optional(),
  paidOn: z
    .string({ error: 'Enter the date.' })
    .trim()
    .refine((value) => parseCalendarDate(value) !== null, 'Enter the date.'),
  reference: z.string().trim().max(100).optional(),
  note: z.string().trim().max(300).optional(),
  requestKey: z.string().optional(),
});

/** Repays an owner, up to what the workshop owes them. */
export async function reimburseOwner(
  user: AuthenticatedUser,
  personUserId: string,
  rawInput: unknown,
) {
  const input = parseInput(reimburseSchema, rawInput);
  requirePermission(user, 'accounting.create');
  if (input.paidOn > localDateString()) {
    throw new DomainError('A repayment can’t be dated in the future.', 'paidOn');
  }
  const amount = toFils(input.amount);

  return prisma.$transaction(async (tx) => {
    await claimRequestKey(tx, user, rawInput, 'owner_reimbursement.record');
    const person = await tx.user.findFirst({
      where: { id: personUserId, organizationId: user.organizationId },
      select: { id: true, fullName: true },
    });
    if (!person) throw new NotFoundError('person');
    // One repayment to this person at a time, so two can't both pass the check below.
    await tx.$executeRaw`SELECT id FROM users WHERE id = ${person.id}::uuid FOR UPDATE`;

    const owed = await owedFils(tx, user.organizationId, person.id);
    if (owed <= 0) throw new DomainError(`Nothing is owed to ${person.fullName}.`, 'amount');
    if (amount > owed) {
      throw new DomainError(
        `That is more than the ${filsToString(owed)} owed to ${person.fullName}.`,
        'amount',
      );
    }
    const accountId = await checkMoneyAccount(tx, user.organizationId, input.accountId);
    await refuseCardSettlementAccount(tx, user.organizationId, input.method, accountId, 'method');

    const row = await tx.ownerReimbursement.create({
      data: {
        organizationId: user.organizationId,
        personUserId: person.id,
        amount: filsToString(amount),
        method: input.method,
        paidFromAccountId: accountId,
        reference: emptyToNull(input.reference),
        note: emptyToNull(input.note),
        paidOn: parseCalendarDate(input.paidOn)!,
        recordedByUserId: user.id,
      },
      select: { id: true },
    });
    await syncPosting(tx, user.organizationId, 'OWNER_REIMBURSEMENT', row.id, user.id);
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: 'owner_reimbursement.recorded',
      entityType: 'OwnerReimbursement',
      entityId: row.id,
      afterData: {
        name: person.fullName,
        amount: filsToString(amount),
        method: input.method,
        paidOn: input.paidOn,
        owedBefore: filsToString(owed),
        owedAfter: filsToString(owed - amount),
      },
    });
    await settleRequestKey(tx, user, rawInput, row.id);
    return { id: row.id, owedAfter: filsToString(owed - amount) };
  });
}

const reversalSchema = z.object({
  reason: z
    .string({ error: 'Say why it is being reversed.' })
    .trim()
    .min(3, 'Say why it is being reversed.')
    .max(300),
  requestKey: z.string().optional(),
});

/** Reverses a repayment made in error: the original stays, a reversal cancels it. */
export async function reverseOwnerReimbursement(
  user: AuthenticatedUser,
  reimbursementId: string,
  rawInput: unknown,
) {
  const input = parseInput(reversalSchema, rawInput);
  requirePermission(user, 'accounting.delete');

  return prisma.$transaction(async (tx) => {
    await claimRequestKey(tx, user, rawInput, 'owner_reimbursement.reversal');
    const row = await tx.ownerReimbursement.findFirst({
      where: { id: reimbursementId, organizationId: user.organizationId },
      select: {
        id: true,
        amount: true,
        method: true,
        status: true,
        paidFromAccountId: true,
        personUserId: true,
        reversalOfId: true,
        reversals: { select: { id: true } },
        person: { select: { fullName: true } },
      },
    });
    if (!row) throw new NotFoundError('repayment');
    if (row.reversalOfId) throw new DomainError('That row is itself a reversal.');
    if (row.status === 'REVERSED' || row.reversals.length > 0) {
      throw new DomainError('This repayment has already been reversed.');
    }

    const reversal = await tx.ownerReimbursement.create({
      data: {
        organizationId: user.organizationId,
        personUserId: row.personUserId,
        // Same amount; a reversal is known by its link, not a negative number.
        amount: row.amount.toString(),
        method: row.method,
        status: 'REVERSED',
        paidFromAccountId: row.paidFromAccountId,
        note: `Reversal: ${input.reason}`,
        reversalOfId: row.id,
        paidOn: parseCalendarDate(localDateString())!,
        recordedByUserId: user.id,
      },
      select: { id: true },
    });
    await tx.ownerReimbursement.update({ where: { id: row.id }, data: { status: 'REVERSED' } });
    await syncPosting(tx, user.organizationId, 'OWNER_REIMBURSEMENT', reversal.id, user.id);

    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: 'owner_reimbursement.reversed',
      entityType: 'OwnerReimbursement',
      entityId: row.id,
      beforeData: { status: row.status, amount: row.amount.toString() },
      afterData: { status: 'REVERSED', reversalId: reversal.id, name: row.person.fullName },
      metadata: { reason: input.reason, amount: row.amount.toString() },
    });
    await settleRequestKey(tx, user, rawInput, reversal.id);
    return { id: reversal.id, reversedId: row.id };
  });
}
