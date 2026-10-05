import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { hasPermission, requirePermission } from '@/lib/auth/authorize';
import { filsToString, toFils } from '@/lib/money';
import {
  getFinanceDashboard,
  resolvePeriod,
  type FinanceDashboardInput,
} from '@/lib/finance/dashboard';
import { salesReport } from '@/lib/reports/workshop';
import { comparisonOf, growth } from '@/lib/overview/compare';

/*
 * Sales in full: what was invoiced and collected (against the period
 * before), what customers still owe, how quotations turn into work, credit
 * notes, the best customers and twelve months of sales.
 */

export async function getSalesOverview(user: AuthenticatedUser, input: FinanceDashboardInput) {
  const scope = user.primaryBranchId ? { branchId: user.primaryBranchId } : undefined;
  requirePermission(user, 'invoice.view', scope);
  const period = resolvePeriod(input);
  const compare = comparisonOf(period);
  const earlierPeriod = resolvePeriod(compare.input);
  const organizationId = user.organizationId;
  const branch = user.primaryBranchId ? { branchId: user.primaryBranchId } : {};
  const window = { gte: period.start, lt: period.end };
  const dates = {
    gte: new Date(`${period.from}T00:00:00Z`),
    lte: new Date(`${period.to}T00:00:00Z`),
  };
  const canQuotes = hasPermission(user, 'quotation.view', scope);
  const canCredits = hasPermission(user, 'credit_note.view', scope);

  const [sales, earlierSales, finance, earlierFinance, sent, decisions, credits, recent] =
    await Promise.all([
      salesReport(user, period),
      salesReport(user, earlierPeriod),
      getFinanceDashboard(user, input),
      getFinanceDashboard(user, compare.input),
      canQuotes
        ? prisma.estimate.findMany({
            where: { organizationId, ...branch, sentAt: window, previousVersionId: null },
            select: { totalAmount: true },
          })
        : null,
      canQuotes
        ? prisma.approval.findMany({
            where: { organizationId, decidedAt: window, estimate: { organizationId, ...branch } },
            select: { status: true, estimate: { select: { totalAmount: true } } },
          })
        : null,
      canCredits
        ? prisma.creditNote.aggregate({
            where: { organizationId, status: { not: 'VOID' }, issueDate: dates, invoice: branch },
            _sum: { totalAmount: true },
            _count: { _all: true },
          })
        : null,
      prisma.invoice.findMany({
        where: {
          organizationId,
          ...branch,
          status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] },
        },
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
        take: 6,
        select: {
          id: true,
          invoiceNumber: true,
          issueDate: true,
          totalAmount: true,
          status: true,
          customerName: true,
          customer: { select: { name: true } },
        },
      }),
    ]);

  const fils = (value: string | undefined | null) => (value ? toFils(value) : 0);
  const approved = decisions?.filter((d) => d.status !== 'REJECTED') ?? [];
  const declined = decisions?.filter((d) => d.status === 'REJECTED') ?? [];

  return {
    period,
    compareLabel: compare.label,
    sales: {
      ...sales,
      totalGrowth: growth(fils(sales.total), fils(earlierSales.total)),
      countGrowth: growth(sales.count, earlierSales.count),
      averageGrowth: growth(fils(sales.average), fils(earlierSales.average)),
    },
    gross: finance.revenue?.gross ?? '0.00',
    collected: finance.revenue?.collected ?? '0.00',
    collectedGrowth:
      finance.revenue && earlierFinance.revenue
        ? growth(fils(finance.revenue.collected), fils(earlierFinance.revenue.collected))
        : null,
    settlement: finance.revenue?.settlement ?? null,
    receivables: finance.receivables,
    quotations: sent
      ? {
          sent: sent.length,
          sentValue: filsToString(
            sent.reduce((sum, e) => sum + toFils(e.totalAmount.toString()), 0),
          ),
          approved: approved.length,
          approvedValue: filsToString(
            approved.reduce((sum, d) => sum + toFils(d.estimate.totalAmount.toString()), 0),
          ),
          declined: declined.length,
          /** Of the quotations decided in the period, the share approved. */
          conversion:
            approved.length + declined.length > 0
              ? Math.round((approved.length / (approved.length + declined.length)) * 1000) / 10
              : null,
        }
      : null,
    credits: credits
      ? {
          count: credits._count._all,
          total: filsToString(toFils(credits._sum.totalAmount?.toString() ?? '0')),
        }
      : null,
    recent: recent.map((invoice) => ({
      id: invoice.id,
      number: invoice.invoiceNumber,
      date: invoice.issueDate,
      customer: invoice.customerName ?? invoice.customer.name,
      total: invoice.totalAmount.toString(),
      status: invoice.status,
    })),
  };
}

export type SalesOverview = Awaited<ReturnType<typeof getSalesOverview>>;
