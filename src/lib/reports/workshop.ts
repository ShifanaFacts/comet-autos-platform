import type { InvoiceStatus } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { AuthError, hasPermission, requirePermission } from '@/lib/auth/authorize';
import { filsToString, formatMilli, toFils } from '@/lib/money';
import { parseCalendarDate } from '@/lib/format';
import { resolvePeriod, type ResolvedPeriod } from '@/lib/finance/dashboard';
import { withNetQuantities } from '@/lib/inventory/stock';

/*
 * Reports: how the workshop is doing, for a chosen period.
 *
 * Each section is shown only to someone whose role covers it — sales with
 * `invoice.view`, the workshop and technicians with `job_card.view`, parts
 * with `inventory.view` — and a section someone may not see is never
 * queried at all.
 *
 * Sales follow the same rule as the profit & loss: tax invoices issued in the
 * period, net of VAT; DRAFT, VOID, CANCELLED and pro-forma never count. Parts
 * are counted net of any taken back from a job. Money is integer fils.
 */

const SALE_STATUSES: InvoiceStatus[] = ['ISSUED', 'PARTIALLY_PAID', 'PAID'];
const DAY_MS = 86_400_000;

const fils = (value: { toString(): string } | null | undefined) =>
  value ? toFils(value.toString()) : 0;

export interface ReportInput {
  period?: string;
  from?: string;
  to?: string;
}

export function reportAccess(user: AuthenticatedUser) {
  const scope = user.primaryBranchId ? { branchId: user.primaryBranchId } : undefined;
  return {
    sales: hasPermission(user, 'invoice.view', scope),
    workshop: hasPermission(user, 'job_card.view', scope),
    parts: hasPermission(user, 'inventory.view', scope),
  };
}

/** Top entries by value, keeping the order stable for equal values. */
function top<T extends { valueFils: number }>(rows: T[], count = 10) {
  return [...rows].sort((a, b) => b.valueFils - a.valueFils).slice(0, count);
}

/** For a role given reports; inside it, each area only for whoever may view that area. */
export async function getWorkshopReport(user: AuthenticatedUser, input: ReportInput = {}) {
  requirePermission(user, 'reports.view');
  const access = reportAccess(user);
  if (!access.sales && !access.workshop && !access.parts) {
    throw new AuthError('Missing permission: invoice.view');
  }
  const period: ResolvedPeriod = resolvePeriod(input);
  const [sales, workshop, parts] = await Promise.all([
    access.sales ? salesReport(user, period) : null,
    access.workshop ? workshopReport(user, period) : null,
    access.parts ? partsReport(user, period) : null,
  ]);
  return { period, access, sales, workshop, parts };
}

export type WorkshopReport = Awaited<ReturnType<typeof getWorkshopReport>>;

// ─── Sales ──────────────────────────────────────────────────────────────────

async function salesReport(user: AuthenticatedUser, period: ResolvedPeriod) {
  const organizationId = user.organizationId;
  const branch = user.primaryBranchId ? { branchId: user.primaryBranchId } : {};

  // Twelve calendar months ending with the one the period ends in.
  const [endYear, endMonth] = period.to.split('-').map(Number);
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(endYear, endMonth - 12 + index, 1));
    return date.toISOString().slice(0, 7);
  });
  const trendFrom = parseCalendarDate(`${months[0]}-01`)!;
  const trendTo = new Date(Date.UTC(endYear, endMonth, 0));
  const dates = { gte: parseCalendarDate(period.from)!, lte: parseCalendarDate(period.to)! };

  const [trendInvoices, customerGroups] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        organizationId,
        ...branch,
        invoiceType: 'TAX_INVOICE',
        status: { in: SALE_STATUSES },
        issueDate: { gte: trendFrom, lte: trendTo },
      },
      select: { issueDate: true, subtotal: true },
    }),
    prisma.invoice.groupBy({
      by: ['customerId'],
      where: {
        organizationId,
        ...branch,
        invoiceType: 'TAX_INVOICE',
        status: { in: SALE_STATUSES },
        issueDate: dates,
      },
      _sum: { subtotal: true },
      _count: { _all: true },
    }),
  ]);

  const byMonth = new Map(months.map((month) => [month, { fils: 0, count: 0 }]));
  for (const invoice of trendInvoices) {
    const entry = byMonth.get(invoice.issueDate.toISOString().slice(0, 7));
    if (!entry) continue;
    entry.fils += fils(invoice.subtotal);
    entry.count += 1;
  }

  const periodFils = customerGroups.reduce((sum, row) => sum + fils(row._sum.subtotal), 0);
  const periodCount = customerGroups.reduce((sum, row) => sum + row._count._all, 0);
  const leaders = top(
    customerGroups.map((row) => ({
      id: row.customerId,
      valueFils: fils(row._sum.subtotal),
      count: row._count._all,
    })),
  );
  const names = new Map(
    (
      await prisma.customer.findMany({
        where: { organizationId, id: { in: leaders.map((row) => row.id) } },
        select: { id: true, name: true },
      })
    ).map((customer) => [customer.id, customer.name]),
  );

  return {
    total: filsToString(periodFils),
    count: periodCount,
    average: filsToString(periodCount ? Math.round(periodFils / periodCount) : 0),
    customers: customerGroups.length,
    monthly: months.map((month) => {
      const entry = byMonth.get(month)!;
      return {
        month,
        label: new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-AE', {
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }),
        valueFils: entry.fils,
        value: filsToString(entry.fils),
        count: entry.count,
      };
    }),
    topCustomers: leaders.map((row) => ({
      ...row,
      name: names.get(row.id) ?? 'Customer',
      value: filsToString(row.valueFils),
    })),
  };
}

// ─── Workshop & technicians ─────────────────────────────────────────────────

async function workshopReport(user: AuthenticatedUser, period: ResolvedPeriod) {
  const organizationId = user.organizationId;
  const branch = user.primaryBranchId ? { branchId: user.primaryBranchId } : {};
  const window = { gte: period.start, lt: period.end };

  const [opened, delivered, openNow, labour] = await Promise.all([
    prisma.jobCard.findMany({
      where: { organizationId, ...branch, openedAt: window },
      select: { status: true, vehicle: { select: { make: true } } },
    }),
    prisma.jobCard.findMany({
      where: { organizationId, ...branch, deliveredAt: window },
      select: { openedAt: true, deliveredAt: true },
    }),
    prisma.jobCard.count({
      where: {
        organizationId,
        ...branch,
        status: { notIn: ['DELIVERED', 'CLOSED', 'CANCELLED', 'REJECTED'] },
      },
    }),
    prisma.labour.groupBy({
      by: ['performedByEmployeeId'],
      where: { organizationId, performedAt: window, jobCard: { organizationId, ...branch } },
      _sum: { hours: true, amount: true },
      _count: { _all: true },
    }),
  ]);

  const turnaround = delivered
    .filter((job) => job.deliveredAt)
    .map((job) => (job.deliveredAt!.getTime() - job.openedAt.getTime()) / DAY_MS);
  const averageDays = turnaround.length
    ? Math.round((turnaround.reduce((a, b) => a + b, 0) / turnaround.length) * 10) / 10
    : null;

  const makes = new Map<string, number>();
  for (const job of opened) {
    const make = job.vehicle.make?.trim() || 'Unknown';
    makes.set(make, (makes.get(make) ?? 0) + 1);
  }

  const employees = new Map(
    (
      await prisma.employee.findMany({
        where: { organizationId, id: { in: labour.map((row) => row.performedByEmployeeId) } },
        select: { id: true, firstName: true, lastName: true, jobTitle: true },
      })
    ).map((employee) => [employee.id, employee]),
  );

  // Hours are Decimal(8,2): summed as hundredths to stay exact.
  const technicians = labour
    .map((row) => {
      const employee = employees.get(row.performedByEmployeeId);
      const hundredths = fils(row._sum.hours);
      return {
        id: row.performedByEmployeeId,
        name: employee ? `${employee.firstName} ${employee.lastName}` : 'Employee',
        jobTitle: employee?.jobTitle ?? null,
        valueFils: hundredths,
        hours: filsToString(hundredths).replace(/\.00$/, ''),
        billed: filsToString(fils(row._sum.amount)),
        entries: row._count._all,
      };
    })
    .sort((a, b) => b.valueFils - a.valueFils);

  return {
    opened: opened.length,
    cancelled: opened.filter((job) => job.status === 'CANCELLED').length,
    delivered: delivered.length,
    openNow,
    averageDays,
    makes: [...makes.entries()]
      .map(([make, count]) => ({ make, count, valueFils: count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    technicians,
    totalHours: filsToString(technicians.reduce((sum, row) => sum + row.valueFils, 0)).replace(
      /\.00$/,
      '',
    ),
  };
}

// ─── Parts ──────────────────────────────────────────────────────────────────

async function partsReport(user: AuthenticatedUser, period: ResolvedPeriod) {
  const organizationId = user.organizationId;
  const branch = user.primaryBranchId ? { branchId: user.primaryBranchId } : {};

  const usages = await prisma.partUsage.findMany({
    where: {
      organizationId,
      usedAt: { gte: period.start, lt: period.end },
      jobCard: { organizationId, ...branch },
    },
    select: {
      id: true,
      partId: true,
      quantity: true,
      unitCost: true,
      unitPrice: true,
      part: { select: { name: true, sku: true } },
    },
  });
  const net = await withNetQuantities(prisma, organizationId, usages);

  const byPart = new Map<
    string,
    { id: string; name: string; sku: string; milli: number; costFils: number; valueFils: number }
  >();
  for (const usage of net) {
    if (usage.netMilli <= 0) continue;
    const entry = byPart.get(usage.partId) ?? {
      id: usage.partId,
      name: usage.part.name,
      sku: usage.part.sku,
      milli: 0,
      costFils: 0,
      valueFils: 0,
    };
    entry.milli += usage.netMilli;
    entry.costFils += Math.round((usage.netMilli * fils(usage.unitCost)) / 1000);
    entry.valueFils += Math.round((usage.netMilli * fils(usage.unitPrice)) / 1000);
    byPart.set(usage.partId, entry);
  }
  const rows = [...byPart.values()];
  const costFils = rows.reduce((sum, row) => sum + row.costFils, 0);
  const valueFils = rows.reduce((sum, row) => sum + row.valueFils, 0);

  return {
    distinct: rows.length,
    cost: filsToString(costFils),
    value: filsToString(valueFils),
    /** Price over cost, as a percentage of price; null when nothing was fitted. */
    margin: valueFils > 0 ? Math.round(((valueFils - costFils) * 1000) / valueFils) / 10 : null,
    top: top(rows).map((row) => ({
      ...row,
      quantity: formatMilli(row.milli),
      value: filsToString(row.valueFils),
      cost: filsToString(row.costFils),
    })),
  };
}
