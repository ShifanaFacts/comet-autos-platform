import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { DomainError, NotFoundError } from '@/lib/errors';
import { parseInput } from '@/lib/form-data';
import { filsToString, toFils } from '@/lib/money';
import { localDateString, parseCalendarDate } from '@/lib/format';
import { allocateDocumentNumber } from '@/lib/numbering';
import { syncPosting } from '@/lib/accounting/journal';
import { checkMoneyAccount } from '@/lib/accounting/chart';
import { depreciationPlan, monthEnd, monthIndex, monthLabel } from '@/lib/accounting/depreciation';

export { depreciationPlan } from '@/lib/accounting/depreciation';

/*
 * The fixed asset register — equipment, vehicles, furniture, computers and
 * fit-out the workshop owns and uses for more than a year (IAS 16).
 *
 * An asset is recorded at cost and depreciated straight-line, monthly, down
 * to its residual value over its useful life:
 *
 *   bought        Dr the asset account, Cr the account paid from (or trade
 *                 payables on credit) — on the day it was bought;
 *   owned before  Dr the asset account at cost, Cr opening balance equity,
 *   the books     with the depreciation already charged (Dr opening balance
 *                 equity, Cr accumulated depreciation) — on the day that
 *                 depreciation was charged to;
 *   each month    Dr depreciation expense, Cr accumulated depreciation;
 *   sold/scrapped the cost and its depreciation come off; the proceeds come
 *                 in; the difference is a gain or loss on disposal.
 *
 * Depreciation starts the month after the asset is acquired (or, for one
 * brought in, the month after its opening depreciation), and each month's
 * charge is the change in a cumulative figure rounded to the fil — so the
 * charges add up to exactly cost − residual − opening, never a fil more.
 * A month is charged once (one row per asset per month) and is booked on
 * its last day.
 */

const AMOUNT = /^\d+(\.\d{1,2})?$/;

const assetSchema = z.object({
  name: z.string({ error: 'Name the asset.' }).trim().min(2, 'Name the asset.').max(120),
  description: z.string().trim().max(500).optional(),
  assetAccountId: z.uuid({ error: 'Choose the asset account.' }),
  accumulatedAccountId: z.uuid({ error: 'Choose the accumulated depreciation account.' }),
  expenseAccountId: z.uuid({ error: 'Choose the depreciation expense account.' }),
  acquiredOn: z
    .string({ error: 'Enter when it was bought.' })
    .trim()
    .min(1, 'Enter when it was bought.'),
  cost: z
    .string({ error: 'Enter what it cost.' })
    .trim()
    .refine((v) => AMOUNT.test(v) && Number(v) > 0, 'Enter the cost like 15000 or 15000.00.'),
  residualValue: z
    .string()
    .trim()
    .refine((v) => !v || AMOUNT.test(v), 'Enter an amount like 1000.')
    .optional(),
  usefulLifeMonths: z
    .string({ error: 'Enter its useful life.' })
    .trim()
    .refine(
      (v) => /^\d+$/.test(v) && Number(v) > 0 && Number(v) <= 600,
      'Enter the useful life in months, e.g. 60 for five years.',
    ),
  funding: z.enum(['PAID', 'ON_CREDIT', 'OPENING'], { error: 'Say how it was paid for.' }),
  paidFromAccountId: z.union([z.literal(''), z.uuid()]).optional(),
  openingDepreciation: z
    .string()
    .trim()
    .refine((v) => !v || AMOUNT.test(v), 'Enter an amount like 2500.')
    .optional(),
  openingThrough: z.string().trim().optional(),
  requestKey: z.string().optional(),
});

/** Accounts an asset can sit in, and where its depreciation goes. */
export async function getFixedAssetAccountChoices(user: AuthenticatedUser) {
  requirePermission(user, 'accounting.view');
  const accounts = await prisma.chartOfAccount.findMany({
    where: {
      organizationId: user.organizationId,
      isActive: true,
      accountType: { in: ['ASSET', 'EXPENSE'] },
    },
    orderBy: { accountCode: 'asc' },
    select: {
      id: true,
      accountCode: true,
      accountName: true,
      accountType: true,
      role: true,
      isPaymentAccount: true,
    },
  });
  const label = (a: (typeof accounts)[number]) => ({
    id: a.id,
    label: `${a.accountCode} ${a.accountName}`,
    code: a.accountCode,
  });
  const assets = accounts.filter(
    (a) => a.accountType === 'ASSET' && !a.role && !a.isPaymentAccount,
  );
  const isAccumulated = (a: (typeof accounts)[number]) =>
    /accumulated|depreciation/i.test(a.accountName);
  return {
    asset: assets.filter((a) => !isAccumulated(a)).map(label),
    accumulated: assets.filter(isAccumulated).map(label),
    expense: accounts.filter((a) => a.accountType === 'EXPENSE').map(label),
    defaults: {
      asset: assets.find((a) => a.accountCode === '1500')?.id ?? '',
      accumulated: assets.find((a) => a.accountCode === '1590')?.id ?? '',
      expense:
        accounts.find((a) => a.accountCode === '5800')?.id ??
        accounts.find((a) => a.accountType === 'EXPENSE' && /depreciation/i.test(a.accountName))
          ?.id ??
        '',
    },
  };
}

/** Records an asset in the register and books it. */
export async function createFixedAsset(user: AuthenticatedUser, rawInput: unknown) {
  const input = parseInput(assetSchema, rawInput);
  requirePermission(user, 'accounting.edit');
  const today = localDateString();
  const acquiredOn = parseCalendarDate(input.acquiredOn);
  if (!acquiredOn || input.acquiredOn > today) {
    throw new DomainError('Enter when it was bought — not a future date.', 'acquiredOn');
  }
  const costFils = toFils(input.cost);
  const residualFils = input.residualValue ? toFils(input.residualValue) : 0;
  if (residualFils >= costFils) {
    throw new DomainError('The residual value must be less than the cost.', 'residualValue');
  }
  let openingFils = 0;
  let openingThrough: Date | null = null;
  if (input.funding === 'OPENING') {
    openingThrough = input.openingThrough ? parseCalendarDate(input.openingThrough) : null;
    if (!openingThrough || input.openingThrough! > today || openingThrough < acquiredOn) {
      throw new DomainError(
        'Enter the date the books take it over — on or after it was bought, not in the future.',
        'openingThrough',
      );
    }
    openingFils = input.openingDepreciation ? toFils(input.openingDepreciation) : 0;
    if (openingFils > costFils - residualFils) {
      throw new DomainError(
        'Depreciation to date cannot be more than the cost less the residual value.',
        'openingDepreciation',
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    const accounts = await tx.chartOfAccount.findMany({
      where: {
        organizationId: user.organizationId,
        id: { in: [input.assetAccountId, input.accumulatedAccountId, input.expenseAccountId] },
      },
      select: { id: true, accountType: true },
    });
    const typeOf = (id: string) => accounts.find((a) => a.id === id)?.accountType;
    if (typeOf(input.assetAccountId) !== 'ASSET') {
      throw new DomainError('Choose an asset account for it.', 'assetAccountId');
    }
    if (typeOf(input.accumulatedAccountId) !== 'ASSET') {
      throw new DomainError('Choose an accumulated depreciation account.', 'accumulatedAccountId');
    }
    if (input.assetAccountId === input.accumulatedAccountId) {
      throw new DomainError(
        'Accumulated depreciation is kept in its own account, apart from the cost.',
        'accumulatedAccountId',
      );
    }
    if (typeOf(input.expenseAccountId) !== 'EXPENSE') {
      throw new DomainError('Choose an expense account for the depreciation.', 'expenseAccountId');
    }
    const paidFrom =
      input.funding === 'PAID'
        ? await checkMoneyAccount(tx, user.organizationId, input.paidFromAccountId)
        : null;

    const assetNumber = await allocateDocumentNumber(tx, user.organizationId, null, 'FIXED_ASSET');
    const asset = await tx.fixedAsset.create({
      data: {
        organizationId: user.organizationId,
        assetNumber,
        name: input.name,
        description: input.description || null,
        assetAccountId: input.assetAccountId,
        accumulatedAccountId: input.accumulatedAccountId,
        expenseAccountId: input.expenseAccountId,
        acquiredOn,
        cost: filsToString(costFils),
        residualValue: filsToString(residualFils),
        usefulLifeMonths: Number(input.usefulLifeMonths),
        funding: input.funding,
        paidFromAccountId: paidFrom,
        openingDepreciation: filsToString(openingFils),
        openingThrough,
        createdByUserId: user.id,
      },
      select: { id: true },
    });
    await syncPosting(tx, user.organizationId, 'FIXED_ASSET', asset.id, user.id);
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: 'fixed_asset.created',
      entityType: 'FixedAsset',
      entityId: asset.id,
      afterData: { assetNumber, ...input, requestKey: undefined },
    });
    return { fixedAssetId: asset.id, assetNumber };
  });
}

const ASSET_FOR_RUN = {
  id: true,
  assetNumber: true,
  status: true,
  acquiredOn: true,
  cost: true,
  residualValue: true,
  usefulLifeMonths: true,
  funding: true,
  openingDepreciation: true,
  openingThrough: true,
  disposedOn: true,
  depreciations: { orderBy: { periodEnd: 'desc' as const }, take: 1, select: { periodEnd: true } },
} as const;

/**
 * Charges an asset's depreciation for every month not yet charged, up to and
 * including `throughMonth`. One transaction per month, so a closed period
 * stops the run at that month without undoing the ones before it.
 */
async function chargeAsset(
  user: AuthenticatedUser,
  assetId: string,
  throughMonth: number,
): Promise<{ charged: number; failed: string | null }> {
  const asset = await prisma.fixedAsset.findFirstOrThrow({
    where: { id: assetId, organizationId: user.organizationId },
    select: ASSET_FOR_RUN,
  });
  const plan = depreciationPlan(asset);
  const last = Math.min(throughMonth, plan.startMonth + plan.months - 1);
  let charged = 0;
  // The month after the last one charged — months whose charge rounds to nil leave no row.
  const done = asset.depreciations[0]
    ? monthIndex(asset.depreciations[0].periodEnd) - plan.startMonth + 1
    : 0;
  for (let n = done + 1; plan.startMonth + n - 1 <= last; n += 1) {
    const month = plan.startMonth + n - 1;
    const amount = plan.charge(n);
    if (amount <= 0) continue;
    try {
      await prisma.$transaction(async (tx) => {
        const row = await tx.assetDepreciation.create({
          data: {
            organizationId: user.organizationId,
            fixedAssetId: asset.id,
            periodEnd: monthEnd(month),
            amount: filsToString(amount),
          },
          select: { id: true },
        });
        await syncPosting(tx, user.organizationId, 'DEPRECIATION', row.id, user.id);
      });
      charged += 1;
    } catch (error) {
      return {
        charged,
        failed: `${asset.assetNumber} ${monthLabel(month)}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  return { charged, failed: null };
}

const runSchema = z.object({
  throughMonth: z
    .string({ error: 'Choose the month.' })
    .trim()
    .regex(/^\d{4}-\d{2}$/, 'Choose the month.'),
});

const calendarDay = (date: Date) => date.toISOString().slice(0, 10);

/** The latest month that has ended (today, if today is a month's last day), as YYYY-MM. */
export function lastEndedMonth(today = localDateString()) {
  const current = monthIndex(new Date(`${today}T00:00:00Z`));
  const month = calendarDay(monthEnd(current)) === today ? current : current - 1;
  return monthLabel(month);
}

/** Charges depreciation on every asset in use, up to and including a month. */
export async function runDepreciation(user: AuthenticatedUser, rawInput: unknown) {
  const input = parseInput(runSchema, rawInput);
  requirePermission(user, 'accounting.edit');
  const [year, month] = input.throughMonth.split('-').map(Number);
  const through = year * 12 + month - 1;
  // A month is charged once it has ended — on its last day at the earliest.
  if (calendarDay(monthEnd(through)) > localDateString()) {
    throw new DomainError(
      `${input.throughMonth} has not ended yet. Depreciation is charged from a month's last day.`,
      'throughMonth',
    );
  }
  const assets = await prisma.fixedAsset.findMany({
    where: { organizationId: user.organizationId, status: 'ACTIVE' },
    orderBy: { assetNumber: 'asc' },
    select: { id: true },
  });
  let charged = 0;
  const failed: string[] = [];
  for (const asset of assets) {
    const result = await chargeAsset(user, asset.id, through);
    charged += result.charged;
    if (result.failed) failed.push(result.failed);
  }
  await writeAuditLog(prisma, {
    organizationId: user.organizationId,
    actorUserId: user.id,
    action: 'fixed_asset.depreciation_run',
    entityType: 'Organization',
    entityId: user.organizationId,
    afterData: { throughMonth: input.throughMonth, charged, failed: failed.length },
  });
  return { charged, failed };
}

const disposeSchema = z.object({
  disposedOn: z.string({ error: 'Enter the date.' }).trim().min(1, 'Enter the date.'),
  proceeds: z
    .string()
    .trim()
    .refine((v) => !v || AMOUNT.test(v), 'Enter an amount like 5000, or 0 if scrapped.')
    .optional(),
  proceedsAccountId: z.union([z.literal(''), z.uuid()]).optional(),
  requestKey: z.string().optional(),
});

/**
 * Sells or scraps an asset: depreciation is charged up to the end of the
 * month before, then the asset leaves the books with any gain or loss.
 */
export async function disposeFixedAsset(
  user: AuthenticatedUser,
  assetId: string,
  rawInput: unknown,
) {
  const input = parseInput(disposeSchema, rawInput);
  requirePermission(user, 'accounting.edit');
  const disposedOn = parseCalendarDate(input.disposedOn);
  if (!disposedOn || input.disposedOn > localDateString()) {
    throw new DomainError('Enter the date — not a future one.', 'disposedOn');
  }
  const asset = await prisma.fixedAsset.findFirst({
    where: { id: assetId, organizationId: user.organizationId },
    select: { id: true, status: true, acquiredOn: true, openingThrough: true, assetNumber: true },
  });
  if (!asset) throw new NotFoundError('fixed asset');
  if (asset.status !== 'ACTIVE') throw new DomainError('This asset has already been disposed of.');
  const inBooksFrom = asset.openingThrough ?? asset.acquiredOn;
  if (disposedOn < inBooksFrom) {
    throw new DomainError('It cannot leave the books before it came in.', 'disposedOn');
  }

  const run = await chargeAsset(user, asset.id, monthIndex(disposedOn) - 1);
  if (run.failed)
    throw new DomainError(`Depreciation up to the disposal could not be charged — ${run.failed}`);

  const proceedsFils = input.proceeds ? toFils(input.proceeds) : 0;
  return prisma.$transaction(async (tx) => {
    const proceedsAccountId =
      proceedsFils > 0
        ? await checkMoneyAccount(tx, user.organizationId, input.proceedsAccountId)
        : null;
    await tx.fixedAsset.update({
      where: { id: asset.id },
      data: {
        status: 'DISPOSED',
        disposedOn,
        disposalProceeds: filsToString(proceedsFils),
        proceedsAccountId,
      },
    });
    await syncPosting(tx, user.organizationId, 'ASSET_DISPOSAL', asset.id, user.id);
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: 'fixed_asset.disposed',
      entityType: 'FixedAsset',
      entityId: asset.id,
      afterData: {
        disposedOn: input.disposedOn,
        proceeds: filsToString(proceedsFils),
        proceedsAccountId,
        depreciationCharged: run.charged,
      },
    });
    return { fixedAssetId: asset.id };
  });
}

/**
 * Removes an asset recorded in error — only while nothing has been charged
 * on it. Its entry in the books is reversed; its number is not reused.
 */
export async function deleteFixedAsset(user: AuthenticatedUser, assetId: string) {
  requirePermission(user, 'accounting.edit');
  return prisma.$transaction(async (tx) => {
    const asset = await tx.fixedAsset.findFirst({
      where: { id: assetId, organizationId: user.organizationId },
      select: {
        id: true,
        assetNumber: true,
        name: true,
        status: true,
        cost: true,
        _count: { select: { depreciations: true } },
      },
    });
    if (!asset) throw new NotFoundError('fixed asset');
    if (asset.status !== 'ACTIVE' || asset._count.depreciations > 0) {
      throw new DomainError(
        'Depreciation has been charged on this asset, so it stays in the register. Dispose of it instead.',
      );
    }
    await tx.fixedAsset.delete({ where: { id: asset.id } });
    await syncPosting(tx, user.organizationId, 'FIXED_ASSET', asset.id, user.id);
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: 'fixed_asset.deleted',
      entityType: 'FixedAsset',
      entityId: asset.id,
      beforeData: { assetNumber: asset.assetNumber, name: asset.name, cost: asset.cost.toString() },
    });
    return { deleted: true };
  });
}

// ─── Reading ────────────────────────────────────────────────────────────────

/** An asset's figures: depreciation to date and its carrying amount (net book value). */
function assetFigures(asset: {
  cost: { toString(): string };
  openingDepreciation: { toString(): string };
  depreciations: { amount: { toString(): string } }[];
}) {
  const cost = toFils(asset.cost.toString());
  const accumulated =
    toFils(asset.openingDepreciation.toString()) +
    asset.depreciations.reduce((sum, row) => sum + toFils(row.amount.toString()), 0);
  return {
    accumulated: filsToString(accumulated),
    bookValue: filsToString(cost - accumulated),
    accumulatedFils: accumulated,
    bookValueFils: cost - accumulated,
  };
}

/** The register: every asset with its cost, depreciation to date and book value. */
export async function listFixedAssets(user: AuthenticatedUser) {
  requirePermission(user, 'accounting.view');
  const assets = await prisma.fixedAsset.findMany({
    where: { organizationId: user.organizationId },
    orderBy: [{ status: 'asc' }, { assetNumber: 'asc' }],
    select: {
      id: true,
      assetNumber: true,
      name: true,
      status: true,
      acquiredOn: true,
      cost: true,
      residualValue: true,
      usefulLifeMonths: true,
      funding: true,
      openingDepreciation: true,
      openingThrough: true,
      disposedOn: true,
      assetAccount: { select: { accountCode: true, accountName: true } },
      depreciations: { select: { amount: true, periodEnd: true }, orderBy: { periodEnd: 'desc' } },
    },
  });
  const rows = assets.map((asset) => ({
    ...asset,
    ...assetFigures(asset),
    chargedTo: asset.depreciations[0]?.periodEnd ?? asset.openingThrough ?? null,
  }));
  const active = rows.filter((row) => row.status === 'ACTIVE');
  return {
    rows,
    totals: {
      cost: filsToString(active.reduce((s, r) => s + toFils(r.cost.toString()), 0)),
      accumulated: filsToString(active.reduce((s, r) => s + r.accumulatedFils, 0)),
      bookValue: filsToString(active.reduce((s, r) => s + r.bookValueFils, 0)),
    },
  };
}

/** One asset with its full schedule: months charged, and those still to come. */
export async function getFixedAsset(user: AuthenticatedUser, assetId: string) {
  requirePermission(user, 'accounting.view');
  const asset = await prisma.fixedAsset.findFirst({
    where: { id: assetId, organizationId: user.organizationId },
    include: {
      assetAccount: { select: { accountCode: true, accountName: true } },
      accumulated: { select: { accountCode: true, accountName: true } },
      expenseAccount: { select: { accountCode: true, accountName: true } },
      paidFrom: { select: { accountCode: true, accountName: true } },
      proceedsAccount: { select: { accountCode: true, accountName: true } },
      createdBy: { select: { fullName: true } },
      depreciations: {
        orderBy: { periodEnd: 'asc' },
        select: { id: true, periodEnd: true, amount: true },
      },
    },
  });
  if (!asset) throw new NotFoundError('fixed asset');
  const plan = depreciationPlan(asset);
  const figures = assetFigures(asset);
  // Months of the plan behind it: up to the last one charged (depreciations are in date order).
  const lastCharged = asset.depreciations[asset.depreciations.length - 1];
  const charged = lastCharged ? monthIndex(lastCharged.periodEnd) - plan.startMonth + 1 : 0;
  // What is still to come, while it is in use.
  const upcoming =
    asset.status === 'ACTIVE'
      ? Array.from({ length: Math.max(plan.months - charged, 0) }, (_, i) => {
          const n = charged + i + 1;
          return {
            periodEnd: monthEnd(plan.startMonth + n - 1),
            amount: filsToString(plan.charge(n)),
          };
        }).filter((row) => row.amount !== '0.00')
      : [];
  const gainFils =
    asset.status === 'DISPOSED'
      ? toFils(asset.disposalProceeds?.toString() ?? '0') - figures.bookValueFils
      : null;
  return {
    ...asset,
    // The account; `accumulated` below is the figure.
    accumulatedAccount: asset.accumulated,
    ...figures,
    monthlyCharge: filsToString(plan.charge(Math.min(charged + 1, Math.max(plan.months, 1)))),
    remainingMonths: Math.max(plan.months - charged, 0),
    upcoming,
    gainOnDisposal:
      gainFils === null
        ? null
        : gainFils < 0
          ? `-${filsToString(-gainFils)}`
          : filsToString(gainFils),
  };
}

export type FixedAssetDetail = Awaited<ReturnType<typeof getFixedAsset>>;
