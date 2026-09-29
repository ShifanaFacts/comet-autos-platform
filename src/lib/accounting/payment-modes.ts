import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import type { AccountRole, PaymentMethod } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { DomainError, NotFoundError } from '@/lib/errors';
import { parseInput } from '@/lib/form-data';
import { checkMoneyAccount, ensureChart } from '@/lib/accounting/chart';

/*
 * The payment mode master.
 *
 * A payment mode is how money comes in or goes out — "Cash", "Card
 * (Network)", "ADCB current account", "Cheque" — tied to the ledger account
 * it lands in. Choosing a mode on a receipt, a supplier payment, a paid
 * expense or a refund sets both what the record calls the payment (its
 * method) and the account the books post it to. The records themselves keep
 * the method and account, exactly as before modes existed, so every posting
 * rule and report is unchanged.
 *
 * Every workshop starts with five, created the first time they're needed:
 *
 *   Cash            → Cash on hand                   (the default)
 *   Card            → Card settlements receivable    reference required
 *   Bank transfer   → Bank — current account         reference required
 *   Cheque          → Bank — current account         reference required
 *   Online          → Bank — current account
 *
 * Add one per real account — a second bank, petty cash, a card terminal —
 * and retire what isn't used. A mode is never deleted: the payments made with
 * it keep their method and account either way.
 */

type Tx = Prisma.TransactionClient;

export interface PaymentModeOption {
  id: string;
  name: string;
  method: PaymentMethod;
  accountId: string;
  accountName: string;
  requiresReference: boolean;
  isDefault: boolean;
}

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
  ONLINE: 'Online',
};

const DEFAULTS: {
  name: string;
  method: PaymentMethod;
  role: AccountRole;
  requiresReference: boolean;
}[] = [
  { name: 'Cash', method: 'CASH', role: 'CASH', requiresReference: false },
  { name: 'Card', method: 'CARD', role: 'CARD_CLEARING', requiresReference: true },
  { name: 'Bank transfer', method: 'BANK_TRANSFER', role: 'BANK', requiresReference: true },
  { name: 'Cheque', method: 'CHEQUE', role: 'BANK', requiresReference: true },
  { name: 'Online', method: 'ONLINE', role: 'BANK', requiresReference: false },
];

/** Creates the five starting modes when the workshop has none. Safe to repeat. */
export async function ensurePaymentModes(organizationId: string) {
  const existing = await prisma.paymentMode.count({ where: { organizationId } });
  if (existing > 0) return;
  await prisma.$transaction(async (tx) => {
    const roles = await ensureChart(tx, organizationId);
    await tx.paymentMode.createMany({
      data: DEFAULTS.map((mode, index) => ({
        organizationId,
        name: mode.name,
        method: mode.method,
        accountId: roles[mode.role],
        requiresReference: mode.requiresReference,
        isDefault: index === 0,
        sortOrder: index,
      })),
      skipDuplicates: true,
    });
  });
}

/**
 * The modes a form offers — active, for receipts or for payments, the default
 * first. Read inside screens that already check their own permission.
 */
export async function getPaymentModeOptions(
  organizationId: string,
  usage: 'receipts' | 'payments',
): Promise<PaymentModeOption[]> {
  await ensurePaymentModes(organizationId);
  const modes = await prisma.paymentMode.findMany({
    where: {
      organizationId,
      isActive: true,
      account: { isActive: true, isPaymentAccount: true },
      ...(usage === 'receipts' ? { forReceipts: true } : { forPayments: true }),
    },
    orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    include: { account: { select: { accountCode: true, accountName: true } } },
  });
  return modes.map((mode) => ({
    id: mode.id,
    name: mode.name,
    method: mode.method,
    accountId: mode.accountId,
    accountName: `${mode.account.accountCode} · ${mode.account.accountName}`,
    requiresReference: mode.requiresReference,
    isDefault: mode.isDefault,
  }));
}

// ─── The master screen ──────────────────────────────────────────────────────

export async function listPaymentModes(user: AuthenticatedUser) {
  requirePermission(user, 'accounting.view');
  await ensurePaymentModes(user.organizationId);
  const [modes, accounts] = await Promise.all([
    prisma.paymentMode.findMany({
      where: { organizationId: user.organizationId },
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: { account: { select: { accountCode: true, accountName: true, isActive: true } } },
    }),
    prisma.chartOfAccount.findMany({
      where: { organizationId: user.organizationId, isPaymentAccount: true, isActive: true },
      orderBy: { accountCode: 'asc' },
      select: { id: true, accountCode: true, accountName: true },
    }),
  ]);
  return {
    modes: modes.map((mode) => ({
      id: mode.id,
      name: mode.name,
      method: mode.method,
      methodLabel: METHOD_LABEL[mode.method],
      accountId: mode.accountId,
      accountName: `${mode.account.accountCode} · ${mode.account.accountName}`,
      accountRetired: !mode.account.isActive,
      forReceipts: mode.forReceipts,
      forPayments: mode.forPayments,
      requiresReference: mode.requiresReference,
      isDefault: mode.isDefault,
      isActive: mode.isActive,
      sortOrder: mode.sortOrder,
    })),
    accounts: accounts.map((account) => ({
      id: account.id,
      label: `${account.accountCode} · ${account.accountName}`,
    })),
  };
}

export type PaymentModeList = Awaited<ReturnType<typeof listPaymentModes>>;
export type PaymentModeRow = PaymentModeList['modes'][number];

const flag = z.enum(['on', 'true', 'false', '']).optional();
const ticked = (value: string | undefined) => value === 'on' || value === 'true';

const modeSchema = z.object({
  name: z.string({ error: 'Enter a name.' }).trim().min(2, 'Enter a name.').max(60),
  method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'ONLINE'], {
    error: 'Choose what kind of payment it is.',
  }),
  accountId: z.uuid({ error: 'Choose the account it goes into or comes out of.' }),
  forReceipts: flag,
  forPayments: flag,
  requiresReference: flag,
  isDefault: flag,
  isActive: flag,
  sortOrder: z
    .union([z.literal(''), z.string().regex(/^\d{1,3}$/, 'Enter a whole number.')])
    .optional(),
});

function readMode(input: z.infer<typeof modeSchema>) {
  const forReceipts = ticked(input.forReceipts);
  const forPayments = ticked(input.forPayments);
  if (!forReceipts && !forPayments) {
    throw new DomainError('Offer it for receipts, for payments, or both.', 'forReceipts');
  }
  return {
    name: input.name.replace(/\s+/g, ' '),
    method: input.method,
    forReceipts,
    forPayments,
    requiresReference: ticked(input.requiresReference),
    sortOrder: input.sortOrder ? Number(input.sortOrder) : 0,
  };
}

async function assertNameFree(tx: Tx, organizationId: string, name: string, exceptId?: string) {
  const clash = await tx.paymentMode.findFirst({
    where: {
      organizationId,
      name: { equals: name, mode: 'insensitive' },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new DomainError('There is already a payment mode with that name.', 'name');
}

export async function createPaymentMode(user: AuthenticatedUser, rawInput: unknown) {
  requirePermission(user, 'accounting.edit');
  const input = parseInput(modeSchema, rawInput);
  const data = readMode(input);
  const isDefault = ticked(input.isDefault);
  await ensurePaymentModes(user.organizationId);

  return prisma.$transaction(async (tx) => {
    const accountId = await checkMoneyAccount(tx, user.organizationId, input.accountId);
    await assertNameFree(tx, user.organizationId, data.name);
    if (isDefault) {
      await tx.paymentMode.updateMany({
        where: { organizationId: user.organizationId, isDefault: true },
        data: { isDefault: false },
      });
    }
    const mode = await tx.paymentMode.create({
      data: { organizationId: user.organizationId, ...data, accountId: accountId!, isDefault },
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: 'payment_mode.created',
      entityType: 'PaymentMode',
      entityId: mode.id,
      afterData: { ...data, accountId, isDefault },
    });
    return mode;
  });
}

/** Changes a mode for payments made from now on; payments already made keep theirs. */
export async function updatePaymentMode(
  user: AuthenticatedUser,
  modeId: string,
  rawInput: unknown,
) {
  requirePermission(user, 'accounting.edit');
  const input = parseInput(modeSchema, rawInput);
  const data = readMode(input);

  return prisma.$transaction(async (tx) => {
    const before = await tx.paymentMode.findFirst({
      where: { id: modeId, organizationId: user.organizationId },
    });
    if (!before) throw new NotFoundError('payment mode');
    const accountId = await checkMoneyAccount(tx, user.organizationId, input.accountId);
    await assertNameFree(tx, user.organizationId, data.name, before.id);
    const isDefault = ticked(input.isDefault) || before.isDefault;
    const isActive = input.isActive === undefined ? before.isActive : ticked(input.isActive);
    if (!isActive && isDefault) {
      throw new DomainError(
        'The default mode can’t be retired. Make another mode the default first.',
        'isActive',
      );
    }
    if (isDefault && !before.isDefault) {
      await tx.paymentMode.updateMany({
        where: { organizationId: user.organizationId, isDefault: true },
        data: { isDefault: false },
      });
    }
    const mode = await tx.paymentMode.update({
      where: { id: before.id },
      data: { ...data, accountId: accountId!, isDefault, isActive },
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: 'payment_mode.updated',
      entityType: 'PaymentMode',
      entityId: mode.id,
      beforeData: {
        name: before.name,
        method: before.method,
        accountId: before.accountId,
        isDefault: before.isDefault,
        isActive: before.isActive,
      },
      afterData: { ...data, accountId, isDefault, isActive },
    });
    return mode;
  });
}
