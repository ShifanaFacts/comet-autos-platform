import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { resolvePeriod, type FinanceDashboardInput } from '@/lib/finance/dashboard';
import { workshopReport } from '@/lib/reports/workshop';
import { getWorkshopFlow } from '@/lib/data/dashboard';
import { comparisonOf, growth } from '@/lib/overview/compare';

/*
 * The workshop in full: job cards opened and vehicles delivered in the
 * period (against the one before), how long a vehicle stays, the stages the
 * open jobs are at, technician hours, the makes coming in, and twelve months
 * of jobs in and out.
 */

const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;

/** Twelve calendar months ending with the one `to` ("YYYY-MM-DD") falls in, as Dubai instants. */
export function twelveMonths(to: string) {
  const [year, month] = to.split('-').map(Number);
  const months = Array.from({ length: 12 }, (_, index) =>
    new Date(Date.UTC(year, month - 12 + index, 1)).toISOString().slice(0, 7),
  );
  return {
    months,
    from: new Date(Date.UTC(year, month - 12, 1) - DUBAI_OFFSET_MS),
    to: new Date(Date.UTC(year, month, 1) - DUBAI_OFFSET_MS),
    label: (value: string) =>
      new Date(`${value}-01T00:00:00Z`).toLocaleDateString('en-AE', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }),
  };
}

/** The Dubai calendar month of an instant ("2026-10"). */
export const dubaiMonth = (instant: Date) =>
  new Date(instant.getTime() + DUBAI_OFFSET_MS).toISOString().slice(0, 7);

export async function getWorkshopOverview(user: AuthenticatedUser, input: FinanceDashboardInput) {
  const scope = user.primaryBranchId ? { branchId: user.primaryBranchId } : undefined;
  requirePermission(user, 'job_card.view', scope);
  const period = resolvePeriod(input);
  const compare = comparisonOf(period);
  const range = twelveMonths(period.to);
  const branch = user.primaryBranchId ? { branchId: user.primaryBranchId } : {};

  const [report, earlier, flow, opened, delivered] = await Promise.all([
    workshopReport(user, period),
    workshopReport(user, resolvePeriod(compare.input)),
    getWorkshopFlow(user.organizationId),
    prisma.jobCard.findMany({
      where: {
        organizationId: user.organizationId,
        ...branch,
        openedAt: { gte: range.from, lt: range.to },
      },
      select: { openedAt: true },
    }),
    prisma.jobCard.findMany({
      where: {
        organizationId: user.organizationId,
        ...branch,
        deliveredAt: { gte: range.from, lt: range.to },
      },
      select: { deliveredAt: true },
    }),
  ]);

  const counts = new Map(range.months.map((m) => [m, { first: 0, second: 0 }]));
  for (const job of opened) {
    const entry = counts.get(dubaiMonth(job.openedAt));
    if (entry) entry.first += 1;
  }
  for (const job of delivered) {
    const entry = job.deliveredAt ? counts.get(dubaiMonth(job.deliveredAt)) : undefined;
    if (entry) entry.second += 1;
  }

  return {
    period,
    compareLabel: compare.label,
    ...report,
    openedGrowth: growth(report.opened, earlier.opened),
    deliveredGrowth: growth(report.delivered, earlier.delivered),
    daysGrowth:
      report.averageDays !== null && earlier.averageDays !== null
        ? growth(report.averageDays, earlier.averageDays)
        : null,
    actions: flow.actions,
    vehiclesIn: flow.vehiclesCurrentlyIn,
    todaysAppointments: flow.todaysAppointments,
    monthly: range.months.map((month) => ({
      month,
      label: range.label(month),
      ...counts.get(month)!,
    })),
  };
}

export type WorkshopOverview = Awaited<ReturnType<typeof getWorkshopOverview>>;
