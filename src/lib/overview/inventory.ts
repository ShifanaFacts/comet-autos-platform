import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { hasPermission, requirePermission } from '@/lib/auth/authorize';
import { filsToString, toFils } from '@/lib/money';
import { resolvePeriod, type FinanceDashboardInput } from '@/lib/finance/dashboard';
import { listParts } from '@/lib/inventory/parts';
import { getSupplierOutstanding } from '@/lib/finance/outstanding';
import { partsReport } from '@/lib/reports/workshop';
import { comparisonOf, growth } from '@/lib/overview/compare';
import { dubaiMonth, twelveMonths } from '@/lib/overview/workshop';

/*
 * Inventory in full: what the stock is worth at cost, how much is low or
 * gone, what was bought (against the period before) and what was fitted to
 * jobs, the margin on parts, what is owed to suppliers, and twelve months of
 * purchases.
 */

export async function getInventoryOverview(user: AuthenticatedUser, input: FinanceDashboardInput) {
  const scope = user.primaryBranchId ? { branchId: user.primaryBranchId } : undefined;
  requirePermission(user, 'inventory.view', scope);
  const period = resolvePeriod(input);
  const compare = comparisonOf(period);
  const earlier = resolvePeriod(compare.input);
  const organizationId = user.organizationId;
  const branch = user.primaryBranchId ? { branchId: user.primaryBranchId } : {};
  const range = twelveMonths(period.to);
  const canPurchases = hasPermission(user, 'purchase.view', scope);
  const canPayables = hasPermission(user, 'supplier_payment.view', scope);
  const received = (window: { gte: Date; lt: Date }) =>
    prisma.purchase.findMany({
      where: { organizationId, ...branch, status: 'RECEIVED', receivedAt: window },
      select: { receivedAt: true, totalAmount: true },
    });

  const [catalog, fitted, earlierFitted, bought, earlierBought, trend, payables, recent] =
    await Promise.all([
      listParts(user, {}),
      partsReport(user, period),
      partsReport(user, earlier),
      canPurchases ? received({ gte: period.start, lt: period.end }) : null,
      canPurchases ? received({ gte: earlier.start, lt: earlier.end }) : null,
      canPurchases ? received({ gte: range.from, lt: range.to }) : null,
      canPayables ? getSupplierOutstanding(user) : null,
      canPurchases
        ? prisma.purchase.findMany({
            where: { organizationId, ...branch, status: { not: 'CANCELLED' } },
            orderBy: { createdAt: 'desc' },
            take: 6,
            select: {
              id: true,
              purchaseNumber: true,
              status: true,
              totalAmount: true,
              createdAt: true,
              receivedAt: true,
              supplier: { select: { name: true } },
            },
          })
        : null,
    ]);

  const parts = catalog.parts;
  // Stock at cost: what is on the shelf now, valued at each part's cost price.
  const stockFils = parts.reduce((sum, part) => {
    if (part.onHandMilli <= 0 || !part.defaultCostPrice) return sum;
    return sum + Math.round((part.onHandMilli * toFils(part.defaultCostPrice.toString())) / 1000);
  }, 0);
  const total = (rows: { totalAmount: { toString(): string } | null }[] | null) =>
    (rows ?? []).reduce((sum, row) => sum + toFils(row.totalAmount?.toString() ?? '0'), 0);

  const byMonth = new Map(range.months.map((m) => [m, { fils: 0, count: 0 }]));
  for (const purchase of trend ?? []) {
    const entry = purchase.receivedAt ? byMonth.get(dubaiMonth(purchase.receivedAt)) : undefined;
    if (!entry) continue;
    entry.fils += toFils(purchase.totalAmount?.toString() ?? '0');
    entry.count += 1;
  }

  return {
    period,
    compareLabel: compare.label,
    stock: {
      value: filsToString(stockFils),
      parts: parts.length,
      inStock: parts.filter((part) => part.onHandMilli > 0).length,
      low: parts.filter((part) => part.state === 'LOW').length,
      out: parts.filter((part) => part.state === 'OUT').length,
    },
    fitted: {
      ...fitted,
      valueGrowth: growth(toFils(fitted.value), toFils(earlierFitted.value)),
    },
    purchases: bought
      ? {
          count: bought.length,
          total: filsToString(total(bought)),
          totalGrowth: growth(total(bought), total(earlierBought)),
          monthly: range.months.map((month) => {
            const entry = byMonth.get(month)!;
            return {
              month,
              label: range.label(month),
              valueFils: entry.fils,
              value: filsToString(entry.fils),
              count: entry.count,
            };
          }),
        }
      : null,
    payables: payables ? payables.totals : null,
    recent,
  };
}

export type InventoryOverview = Awaited<ReturnType<typeof getInventoryOverview>>;
