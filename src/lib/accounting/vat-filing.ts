import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { DomainError, NotFoundError } from '@/lib/errors';
import { parseInput } from '@/lib/form-data';
import { claimRequestKey, settleRequestKey } from '@/lib/request-keys';
import { toFils } from '@/lib/money';
import { formatCalendarDate, localDateString, parseCalendarDate } from '@/lib/format';
import { emptyToNull } from '@/lib/normalize';
import { getVatReturn, VAT_DUE_DAYS } from '@/lib/finance/vat';
import { syncPosting } from '@/lib/accounting/journal';
import { booksClosedThrough } from '@/lib/accounting/periods';

/*
 * VAT returns, once filed with the FTA.
 *
 * The VAT screen prepares a return (lib/finance/vat.ts) — the VAT201 boxes
 * worked out from invoices, expenses and parts received. The return itself
 * is submitted on the FTA's EmaraTax portal; the workshop then records it
 * here as filed, with the FTA's reference, and later records the payment
 * (or the refund received). Each step is booked:
 *
 *   filed     the period's output and input VAT move into "VAT due to FTA"
 *   paid      "VAT due to FTA" is cleared against the bank
 *
 * Filing normally closes the books through the period's last day, so the
 * figures the FTA received can't change afterwards. A return is due by the
 * 28th day after its period ends; so is the payment.
 */

// The due-date rule lives with the return itself (lib/finance/vat.ts), which
// this file already imports; re-exported so callers keep one place to ask.
export { VAT_DUE_DAYS, vatDueDate } from '@/lib/finance/vat';

const day = (value: string) => parseCalendarDate(value)!;
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

export type VatFilingState = 'PAYMENT_DUE' | 'OVERDUE' | 'PAID' | 'REFUND_DUE' | 'REFUNDED' | 'NIL';

const fileSchema = z.object({
  from: z.string({ error: 'Choose the period.' }).min(1, 'Choose the period.'),
  to: z.string({ error: 'Choose the period.' }).min(1, 'Choose the period.'),
  filedOn: z
    .string({ error: 'Enter the date it was filed.' })
    .min(1, 'Enter the date it was filed.'),
  ftaReference: z.string().trim().max(60, 'Keep the reference under 60 characters.').optional(),
  closeBooks: z.union([z.enum(['true', 'false']), z.array(z.enum(['true', 'false']))]).optional(),
  requestKey: z.string().optional(),
});

/**
 * Records a VAT return as filed with the FTA: the figures for the period as
 * the VAT screen worked them out, booked into what is due to the FTA.
 */
export async function fileVatReturn(user: AuthenticatedUser, rawInput: unknown) {
  requirePermission(user, 'vat.create');
  const input = parseInput(fileSchema, rawInput);
  const from = parseCalendarDate(input.from);
  const to = parseCalendarDate(input.to);
  const filedOn = parseCalendarDate(input.filedOn);
  if (!from || !to || from > to) throw new DomainError('Choose a valid period.', 'from');
  if (!filedOn) throw new DomainError('Enter a valid date.', 'filedOn');
  const today = localDateString();
  if (input.to >= today) {
    throw new DomainError('A return can be filed only once its period has ended.', 'to');
  }
  if (input.filedOn > today)
    throw new DomainError('The filing date can’t be in the future.', 'filedOn');
  if (input.filedOn <= input.to) {
    throw new DomainError('A return is filed after its period ends.', 'filedOn');
  }
  const closeBooks =
    (Array.isArray(input.closeBooks) ? input.closeBooks.at(-1) : input.closeBooks) !== 'false';

  const vat = await getVatReturn(user, { period: 'custom', from: input.from, to: input.to });
  if (!vat.registered) {
    throw new DomainError(
      'The workshop is not VAT-registered, so there is no return to file. Set the TRN and VAT registration in Settings first.',
    );
  }

  return prisma.$transaction(async (tx) => {
    await claimRequestKey(tx, user, rawInput, 'vat.file');
    const overlapping = await tx.vatFiling.findFirst({
      where: {
        organizationId: user.organizationId,
        periodFrom: { lte: to },
        periodTo: { gte: from },
      },
      select: { periodFrom: true, periodTo: true },
    });
    if (overlapping) {
      throw new DomainError(
        `A return for ${formatCalendarDate(overlapping.periodFrom)} to ${formatCalendarDate(overlapping.periodTo)} is already filed, and overlaps this period.`,
        'from',
      );
    }
    const { boxes } = vat;
    const filing = await tx.vatFiling.create({
      data: {
        organizationId: user.organizationId,
        periodFrom: from,
        periodTo: to,
        standardSupplies: boxes.standardSupplies,
        outputVat: boxes.outputVat,
        zeroRatedSupplies: boxes.zeroRatedSupplies,
        standardExpenses: boxes.standardExpenses,
        inputVat: boxes.inputVat,
        netVat: boxes.net,
        ftaReference: emptyToNull(input.ftaReference),
        filedOn,
        filedByUserId: user.id,
      },
    });
    await syncPosting(tx, user.organizationId, 'VAT_FILING', filing.id, user.id);

    // What the FTA received can't change afterwards.
    const closed = await booksClosedThrough(tx, user.organizationId);
    const closing = closeBooks && (!closed || closed < to);
    if (closing) {
      await tx.organization.update({
        where: { id: user.organizationId },
        data: { booksClosedThrough: to },
      });
    }
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: 'vat.filed',
      entityType: 'VatFiling',
      entityId: filing.id,
      afterData: {
        periodFrom: input.from,
        periodTo: input.to,
        filedOn: input.filedOn,
        ftaReference: filing.ftaReference,
        outputVat: boxes.outputVat,
        inputVat: boxes.inputVat,
        netVat: boxes.net,
        booksClosedThrough: closing ? input.to : (closed?.toISOString().slice(0, 10) ?? null),
      },
    });
    await settleRequestKey(tx, user, rawInput, filing.id);
    return filing;
  });
}

const settleSchema = z.object({
  settledOn: z.string({ error: 'Enter the date.' }).min(1, 'Enter the date.'),
  accountId: z.union([z.literal(''), z.uuid()]).optional(),
  reference: z.string().trim().max(100).optional(),
  requestKey: z.string().optional(),
});

/** Records the VAT paid to the FTA for a filed return — or the refund received. */
export async function settleVatReturn(
  user: AuthenticatedUser,
  filingId: string,
  rawInput: unknown,
) {
  requirePermission(user, 'vat.create');
  const input = parseInput(settleSchema, rawInput);
  const settledOn = parseCalendarDate(input.settledOn);
  if (!settledOn) throw new DomainError('Enter a valid date.', 'settledOn');
  if (input.settledOn > localDateString()) {
    throw new DomainError('The date can’t be in the future.', 'settledOn');
  }

  return prisma.$transaction(async (tx) => {
    await claimRequestKey(tx, user, rawInput, 'vat.settle');
    const filing = await tx.vatFiling.findFirst({
      where: { id: filingId, organizationId: user.organizationId },
    });
    if (!filing) throw new NotFoundError('VAT return');
    if (filing.settledOn) throw new DomainError('This return is already settled.');
    if (toFils(filing.netVat.toString().replace('-', '')) === 0) {
      throw new DomainError('Nothing is payable or refundable on this return.');
    }
    if (settledOn < filing.periodTo) {
      throw new DomainError('The payment can’t be dated before the period ended.', 'settledOn');
    }
    if (input.accountId) {
      const account = await tx.chartOfAccount.findFirst({
        where: { id: input.accountId, organizationId: user.organizationId },
        select: { isPaymentAccount: true, isActive: true },
      });
      if (!account?.isPaymentAccount || !account.isActive) {
        throw new DomainError('Choose a cash or bank account.', 'accountId');
      }
    }
    const settled = await tx.vatFiling.update({
      where: { id: filing.id },
      data: {
        settledOn,
        settledAccountId: input.accountId || null,
        settlementReference: emptyToNull(input.reference),
      },
    });
    await syncPosting(tx, user.organizationId, 'VAT_PAYMENT', filing.id, user.id);
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: 'vat.settled',
      entityType: 'VatFiling',
      entityId: filing.id,
      afterData: {
        settledOn: input.settledOn,
        netVat: filing.netVat.toString(),
        reference: settled.settlementReference,
      },
    });
    await settleRequestKey(tx, user, rawInput, filing.id);
    return settled;
  });
}

/** The returns filed, newest first, with when each is due and where it stands. */
export async function listVatFilings(user: AuthenticatedUser) {
  requirePermission(user, 'vat.view');
  const filings = await prisma.vatFiling.findMany({
    where: { organizationId: user.organizationId },
    orderBy: { periodTo: 'desc' },
    include: {
      filedBy: { select: { fullName: true } },
      settledAccount: { select: { accountName: true } },
    },
  });
  const today = day(localDateString());
  return filings.map((filing) => {
    const net = filing.netVat.toString();
    const netFils = net.startsWith('-') ? -toFils(net.slice(1)) : toFils(net);
    const dueOn = addDays(filing.periodTo, VAT_DUE_DAYS);
    const state: VatFilingState =
      netFils === 0
        ? 'NIL'
        : netFils > 0
          ? filing.settledOn
            ? 'PAID'
            : today > dueOn
              ? 'OVERDUE'
              : 'PAYMENT_DUE'
          : filing.settledOn
            ? 'REFUNDED'
            : 'REFUND_DUE';
    return { ...filing, dueOn, state, netFils };
  });
}

export type VatFilingRow = Awaited<ReturnType<typeof listVatFilings>>[number];
