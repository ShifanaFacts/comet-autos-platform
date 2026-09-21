import { prisma } from '@/lib/prisma';
import type { JobCardStatus } from '@/generated/prisma/enums';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { CLOSED_JOB_STATUSES, WORKFLOW_STAGES } from '@/lib/workshop/stages';
import { localDayRange } from '@/lib/format';
import { filsToString, toFils } from '@/lib/money';
import { invoiceBalance, paidFils } from '@/lib/billing/invoice';
import { getStockByPart, resolveInventoryBranch, stockState } from '@/lib/inventory/stock';

/*
 * Dashboard data. "Today" is the workshop's day in Dubai, whatever time zone
 * the server runs in. Money is summed exactly (fils) with the billing rules,
 * and stock uses the same rule as the inventory screens.
 *
 * Each section fetches independently so the page can stream them with
 * <Suspense>; the page wraps these in React cache() to share queries.
 */

// "Currently in the workshop" = not yet handed back to the customer.
const NOT_IN_WORKSHOP: JobCardStatus[] = CLOSED_JOB_STATUSES;

export async function getWorkshopFlow(organizationId: string) {
  const today = localDayRange();

  const [todaysAppointments, vehiclesCurrentlyIn, jobsByStatus] = await Promise.all([
    prisma.appointment.count({
      where: {
        organizationId,
        scheduledAt: { gte: today.start, lt: today.end },
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      },
    }),
    prisma.jobCard.count({ where: { organizationId, status: { notIn: NOT_IN_WORKSHOP } } }),
    prisma.jobCard.groupBy({ by: ['status'], where: { organizationId }, _count: { _all: true } }),
  ]);

  const statusCounts = new Map(jobsByStatus.map((row) => [row.status, row._count._all]));
  const count = (...statuses: JobCardStatus[]) =>
    statuses.reduce((sum, status) => sum + (statusCounts.get(status) ?? 0), 0);

  return {
    todaysAppointments,
    vehiclesCurrentlyIn,
    workflowStages: WORKFLOW_STAGES.map((stage) => ({
      ...stage,
      count: statusCounts.get(stage.status) ?? 0,
    })),
    waitingForApproval: count('WAITING_APPROVAL'),
    onHold: count('ON_HOLD'),
    /** The jobs that need someone to act, by what that action is. */
    actions: {
      toInspect: count('ARRIVED', 'INSPECTION'),
      toQuote: count('DIAGNOSIS', 'ESTIMATE'),
      waitingApproval: count('WAITING_APPROVAL'),
      approved: count('APPROVED'),
      inRepair: count('REPAIR'),
      qualityCheck: count('QUALITY_CHECK'),
      ready: count('READY'),
      awaitingPayment: count('INVOICED'),
      toDeliver: count('PAID'),
      onHold: count('ON_HOLD'),
    },
  };
}

/** Parts at or below their minimum at the user's branch — the same rule as the Parts screen. */
export async function getLowStockParts(user: AuthenticatedUser) {
  const branch = await resolveInventoryBranch(user);
  const [parts, stock] = await Promise.all([
    prisma.part.findMany({
      where: { organizationId: user.organizationId, isActive: true, reorderLevel: { not: null } },
      select: { id: true, name: true, sku: true, unitOfMeasure: true, reorderLevel: true },
    }),
    getStockByPart(user.organizationId, branch.id),
  ]);
  return parts
    .map((part) => {
      const onHandMilli = stock.get(part.id) ?? 0;
      return { ...part, onHandMilli, state: stockState(onHandMilli, part.reorderLevel) };
    })
    .filter((part) => part.state !== 'IN_STOCK')
    .sort((a, b) => a.onHandMilli - b.onHandMilli);
}

/**
 * Today's invoiced sales and collections, and what customers still owe.
 * Only unpaid / part-paid invoices (and their payments) are read for the
 * outstanding figure, and only today's payments for collections.
 */
export async function getFinanceSnapshot(organizationId: string) {
  const today = localDayRange();
  const [openInvoices, todaysInvoices, todaysPayments] = await Promise.all([
    prisma.invoice.findMany({
      where: { organizationId, status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
      select: {
        totalAmount: true,
        status: true,
        payments: {
          select: {
            id: true,
            amount: true,
            status: true,
            reversalOfPaymentId: true,
            receivedAt: true,
          },
        },
      },
    }),
    prisma.invoice.findMany({
      where: {
        organizationId,
        status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] },
        issuedAt: { gte: today.start, lt: today.end },
      },
      select: { totalAmount: true },
    }),
    prisma.payment.findMany({
      where: { organizationId, receivedAt: { gte: today.start, lt: today.end } },
      select: { id: true, amount: true, status: true, reversalOfPaymentId: true },
    }),
  ]);

  const outstandingFils = openInvoices.reduce(
    (sum, invoice) => sum + toFils(invoiceBalance(invoice).balance),
    0,
  );
  return {
    todaysSales: filsToString(
      todaysInvoices.reduce((sum, invoice) => sum + toFils(invoice.totalAmount.toString()), 0),
    ),
    todaysInvoiceCount: todaysInvoices.length,
    todaysCollections: filsToString(paidFils(todaysPayments.filter((p) => !p.reversalOfPaymentId))),
    customerOutstanding: filsToString(outstandingFils),
    unpaidInvoices: openInvoices.length,
  };
}

/** Today's appointments in time order (Dubai day). */
export async function getTodaysAppointments(organizationId: string) {
  const today = localDayRange();
  return prisma.appointment.findMany({
    where: {
      organizationId,
      scheduledAt: { gte: today.start, lt: today.end },
      status: { notIn: ['CANCELLED', 'NO_SHOW'] },
    },
    orderBy: { scheduledAt: 'asc' },
    take: 8,
    select: {
      id: true,
      scheduledAt: true,
      status: true,
      notes: true,
      vehicle: { select: { plateNumber: true, make: true, model: true } },
      customer: { select: { name: true } },
    },
  });
}

/** Most recently opened job cards that are still in the workshop. */
export async function getRecentJobCards(organizationId: string, take = 6) {
  return prisma.jobCard.findMany({
    where: { organizationId, status: { notIn: NOT_IN_WORKSHOP } },
    orderBy: { openedAt: 'desc' },
    take,
    select: {
      id: true,
      jobNumber: true,
      status: true,
      openedAt: true,
      customer: { select: { name: true } },
      vehicle: { select: { plateNumber: true, make: true, model: true } },
    },
  });
}
