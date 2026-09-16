import { prisma } from '@/lib/prisma';
import type { JobCardStatus } from '@/generated/prisma/enums';
import { WORKFLOW_STAGES } from '@/lib/workshop/stages';

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function startOfTomorrow(): Date {
  const start = startOfToday();
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
}

// "Currently in the workshop" = not yet handed back to the customer. The
// frozen schema's JobCardStatus enum doesn't have a separate
// QUALITY_CHECK/READY/DELIVERED breakdown (see PROJECT-STATUS.md Roadmap) —
// COMPLETED/INVOICED jobs are still physically on-site awaiting handover;
// only CLOSED/CANCELLED are actually gone.
const NOT_IN_WORKSHOP: JobCardStatus[] = ['CLOSED', 'CANCELLED'];

export async function getDashboardData(organizationId: string) {
  const todayStart = startOfToday();
  const tomorrowStart = startOfTomorrow();

  const [
    todaysAppointments,
    vehiclesCurrentlyIn,
    jobsByStatus,
    parts,
    outstandingInvoices,
    completedPayments,
    todaysIssuedInvoices,
    todaysCompletedPayments,
  ] = await Promise.all([
    prisma.appointment.count({
      where: { organizationId, scheduledAt: { gte: todayStart, lt: tomorrowStart } },
    }),
    prisma.jobCard.count({
      where: { organizationId, status: { notIn: NOT_IN_WORKSHOP } },
    }),
    prisma.jobCard.groupBy({
      by: ['status'],
      where: { organizationId },
      _count: { _all: true },
    }),
    prisma.part.findMany({
      where: { organizationId, isActive: true, reorderLevel: { not: null } },
      select: { id: true, name: true, sku: true, reorderLevel: true },
    }),
    prisma.invoice.findMany({
      where: { organizationId, status: { in: ['ISSUED', 'PARTIALLY_PAID'] } },
      select: { id: true, totalAmount: true },
    }),
    prisma.payment.findMany({
      where: { organizationId, status: 'COMPLETED' },
      select: { amount: true, invoiceId: true, reversals: { select: { id: true } } },
    }),
    prisma.invoice.aggregate({
      where: {
        organizationId,
        status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] },
        issuedAt: { gte: todayStart, lt: tomorrowStart },
      },
      _sum: { totalAmount: true },
    }),
    prisma.payment.findMany({
      where: { organizationId, status: 'COMPLETED', receivedAt: { gte: todayStart, lt: tomorrowStart } },
      select: { amount: true, reversals: { select: { id: true } } },
    }),
  ]);

  const stockByPart =
    parts.length > 0
      ? await prisma.inventoryTransaction.groupBy({
          by: ['partId'],
          where: { organizationId, partId: { in: parts.map((p) => p.id) } },
          _sum: { quantity: true },
        })
      : [];
  const stockByPartId = new Map(stockByPart.map((row) => [row.partId, row._sum.quantity ?? 0]));

  const lowStockParts = parts
    .map((part) => ({ ...part, currentStock: Number(stockByPartId.get(part.id) ?? 0) }))
    .filter((part) => part.reorderLevel !== null && part.currentStock <= Number(part.reorderLevel));

  const paidByInvoiceId = new Map<string, number>();
  for (const payment of completedPayments) {
    // A payment that itself has been reversed no longer counts toward "paid".
    if (payment.reversals.length > 0) continue;
    paidByInvoiceId.set(
      payment.invoiceId,
      (paidByInvoiceId.get(payment.invoiceId) ?? 0) + Number(payment.amount),
    );
  }
  const customerOutstanding = outstandingInvoices.reduce((sum, invoice) => {
    const paid = paidByInvoiceId.get(invoice.id) ?? 0;
    return sum + Math.max(Number(invoice.totalAmount) - paid, 0);
  }, 0);

  const todaysCollections = todaysCompletedPayments
    .filter((payment) => payment.reversals.length === 0)
    .reduce((sum, payment) => sum + Number(payment.amount), 0);

  const statusCounts = new Map(jobsByStatus.map((row) => [row.status, row._count._all]));

  const workflowStages = WORKFLOW_STAGES.map((stage) => ({
    ...stage,
    count: statusCounts.get(stage.status) ?? 0,
  }));

  return {
    todaysAppointments,
    vehiclesCurrentlyIn,
    statusCounts,
    workflowStages,
    waitingForApproval: statusCounts.get('ESTIMATE_SENT') ?? 0,
    onHold: statusCounts.get('ON_HOLD') ?? 0,
    lowStockParts,
    customerOutstanding,
    todaysSales: Number(todaysIssuedInvoices._sum.totalAmount ?? 0),
    todaysCollections,
  };
}
