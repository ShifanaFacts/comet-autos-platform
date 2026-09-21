import type { InvoiceStatus, Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { AuthError, hasPermission } from '@/lib/auth/authorize';
import { filsToString, toFils } from '@/lib/money';
import { localDateString } from '@/lib/format';
import { getVatSettings } from '@/lib/tax';
import { getCustomerOutstanding, getSupplierOutstanding } from '@/lib/finance/outstanding';

/*
 * The owner's financial picture for a chosen period.
 *
 * Rules, once, here — every figure below follows them:
 *
 *   Revenue    invoices ISSUED in the period, at their own stored amounts.
 *              DRAFT is not revenue; VOID and CANCELLED never count.
 *   Collected  payments received in the period that actually count: completed,
 *              not a reversal, and not since reversed.
 *   Expenses   RECORDED expenses dated in the period. Voided ones never count.
 *   VAT        output tax from those invoices, input tax from those expenses.
 *              An organization that is not VAT-registered reports zero.
 *   Owed       the live figures from lib/finance/outstanding — never a second
 *              version of that calculation.
 *
 * Periods are the workshop's own days in Dubai. `issueDate` and `expenseDate`
 * are DATE columns, so they compare as plain dates; payments carry an instant,
 * so their window is built from Dubai midnight to Dubai midnight.
 *
 * Money: sums are done by the database over `numeric` columns, then converted
 * to integer fils for any arithmetic. Never floating point.
 */

/** Invoices that represent real revenue. DRAFT, VOID and CANCELLED do not. */
const REVENUE_STATUSES: InvoiceStatus[] = ['ISSUED', 'PARTIALLY_PAID', 'PAID'];

export type PeriodKey = 'today' | 'week' | 'month' | 'custom';

export interface ResolvedPeriod {
  key: PeriodKey;
  label: string;
  /** Inclusive Dubai calendar dates, "YYYY-MM-DD". */
  from: string;
  to: string;
  /** Half-open instant window for timestamp columns. */
  start: Date;
  end: Date;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** Dubai has no daylight saving, so a fixed offset is correct all year. */
const OFFSET = '+04:00';

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const asInstant = (day: string) => new Date(`${day}T00:00:00${OFFSET}`);
const addDays = (day: string, days: number) =>
  localDateString(new Date(asInstant(day).getTime() + days * 86_400_000));

/**
 * Turns a period choice into the exact window used by every figure, so the
 * screen can state precisely which days it is reporting on.
 */
export function resolvePeriod(input: {
  period?: string;
  from?: string;
  to?: string;
}): ResolvedPeriod {
  const today = localDateString();
  let key: PeriodKey = 'month';
  let from = today;
  let to = today;
  let label = '';

  if (input.period === 'today') {
    key = 'today';
    label = 'Today';
  } else if (input.period === 'week') {
    key = 'week';
    // The workshop week starts on Monday.
    const weekday = (asInstant(today).getUTCDay() + 6) % 7;
    from = addDays(today, -weekday);
    label = 'This week';
  } else if (
    input.period === 'custom' &&
    DATE_ONLY.test(input.from ?? '') &&
    DATE_ONLY.test(input.to ?? '')
  ) {
    key = 'custom';
    from = input.from!;
    to = input.to!;
    if (from > to) [from, to] = [to, from];
    label = 'Custom range';
  } else {
    from = `${today.slice(0, 7)}-01`;
    label = 'This month';
  }

  return {
    key,
    label,
    from,
    to,
    start: asInstant(from),
    // Half-open: up to, but not including, the morning after `to`.
    end: asInstant(addDays(to, 1)),
  };
}

/** What this user may see. Finance is never all-or-nothing. */
export function financeAccess(user: AuthenticatedUser) {
  const scope = user.primaryBranchId ? { branchId: user.primaryBranchId } : undefined;
  return {
    sales: hasPermission(user, 'invoice.view', scope),
    expenses: hasPermission(user, 'accounting.view', scope),
    payables: hasPermission(user, 'inventory.view', scope),
  };
}

export type FinanceAccess = ReturnType<typeof financeAccess>;

const money = (value: { toString(): string } | null | undefined) =>
  filsToString(value ? toFils(value.toString()) : 0);

export interface FinanceDashboardInput {
  period?: string;
  from?: string;
  to?: string;
}

/**
 * Everything the finance screen shows, for one period. Independent reads run
 * together; each section is skipped entirely when the user may not see it.
 */
export async function getFinanceDashboard(
  user: AuthenticatedUser,
  input: FinanceDashboardInput = {},
) {
  const access = financeAccess(user);
  if (!access.sales && !access.expenses && !access.payables) {
    throw new AuthError('Missing permission: invoice.view');
  }
  const period = resolvePeriod(input);
  const organizationId = user.organizationId;
  // A user tied to a branch sees that branch's money, and only that.
  const branch: Prisma.InvoiceWhereInput = user.primaryBranchId
    ? { branchId: user.primaryBranchId }
    : {};
  const dateWindow = { gte: asDate(period.from), lte: asDate(period.to) };

  const [revenue, collected, expenses, categories, receivables, payables, recent, vat] =
    await Promise.all([
      // --- Revenue: summed by the database over the invoices' own amounts.
      access.sales
        ? prisma.invoice.aggregate({
            where: {
              organizationId,
              ...branch,
              status: { in: REVENUE_STATUSES },
              issueDate: dateWindow,
            },
            _sum: { subtotal: true, taxAmount: true, totalAmount: true },
            _count: { _all: true },
          })
        : null,

      // --- Collected: the payments that actually count, in this window.
      access.sales
        ? prisma.payment.findMany({
            where: {
              organizationId,
              status: 'COMPLETED',
              receivedAt: { gte: period.start, lt: period.end },
              invoice: { organizationId, ...branch, status: { notIn: ['VOID', 'CANCELLED'] } },
            },
            select: { id: true, amount: true, reversalOfPaymentId: true },
          })
        : null,

      // --- Expenses: voided ones are excluded by status.
      access.expenses
        ? prisma.expense.aggregate({
            where: {
              organizationId,
              ...(user.primaryBranchId ? { branchId: user.primaryBranchId } : {}),
              status: 'RECORDED',
              expenseDate: dateWindow,
            },
            _sum: { amount: true, taxAmount: true },
            _count: { _all: true },
          })
        : null,

      access.expenses
        ? prisma.expense.groupBy({
            by: ['chartOfAccountId'],
            where: {
              organizationId,
              ...(user.primaryBranchId ? { branchId: user.primaryBranchId } : {}),
              status: 'RECORDED',
              expenseDate: dateWindow,
            },
            _sum: { amount: true, taxAmount: true },
            _count: { _all: true },
          })
        : null,

      // --- Owed: the same calculation the outstanding screen uses.
      access.sales ? getCustomerOutstanding(user) : null,
      access.payables ? getSupplierOutstanding(user) : null,

      recentActivity(user, access, branch),
      getVatSettings(organizationId),
    ]);

  // Collected: exclude a reversal row and the payment it reversed.
  let collectedFils = 0;
  if (collected) {
    const reversed = new Set(
      collected.map((payment) => payment.reversalOfPaymentId).filter(Boolean),
    );
    collectedFils = collected
      .filter((payment) => !payment.reversalOfPaymentId && !reversed.has(payment.id))
      .reduce((sum, payment) => sum + toFils(payment.amount.toString()), 0);
  }

  const revenueNet = toFils(revenue?._sum.subtotal?.toString() ?? '0');
  const revenueVat = toFils(revenue?._sum.taxAmount?.toString() ?? '0');
  const revenueGross = toFils(revenue?._sum.totalAmount?.toString() ?? '0');
  const expenseNet = toFils(expenses?._sum.amount?.toString() ?? '0');
  const expenseVat = toFils(expenses?._sum.taxAmount?.toString() ?? '0');

  // Not VAT-registered means nothing is charged or reclaimed.
  const registered = vat.isVatRegistered;
  const outputVat = registered ? revenueVat : 0;
  const inputVat = registered ? expenseVat : 0;

  const accountNames = categories?.length
    ? new Map(
        (
          await prisma.chartOfAccount.findMany({
            where: {
              organizationId,
              id: { in: categories.map((c) => c.chartOfAccountId).filter(Boolean) as string[] },
            },
            select: { id: true, accountName: true },
          })
        ).map((account) => [account.id, account.accountName]),
      )
    : new Map<string, string>();

  return {
    period,
    access,
    vat: {
      isRegistered: registered,
      rate: vat.vatRate,
      taxNumber: vat.taxNumber,
      output: filsToString(outputVat),
      input: filsToString(inputVat),
      /** Positive: owed to the tax authority. Negative: reclaimable. */
      net: filsToString(outputVat - inputVat),
    },
    revenue: access.sales
      ? {
          net: filsToString(revenueNet),
          vat: filsToString(revenueVat),
          gross: filsToString(revenueGross),
          count: revenue?._count._all ?? 0,
          collected: filsToString(collectedFils),
        }
      : null,
    expenses: access.expenses
      ? {
          net: filsToString(expenseNet),
          vat: filsToString(expenseVat),
          gross: filsToString(expenseNet + expenseVat),
          count: expenses?._count._all ?? 0,
          topCategories: (categories ?? [])
            .map((row) => ({
              id: row.chartOfAccountId,
              name: row.chartOfAccountId
                ? (accountNames.get(row.chartOfAccountId) ?? 'Uncategorised')
                : 'Uncategorised',
              net: money(row._sum.amount),
              netFils: toFils(row._sum.amount?.toString() ?? '0'),
              count: row._count._all,
            }))
            .sort((a, b) => b.netFils - a.netFils)
            .slice(0, 5),
        }
      : null,
    /**
     * Revenue less expenses for the period — an operating margin from the
     * records that exist, not an accounting profit. Both sides exclude VAT,
     * which is neither income nor cost.
     */
    position:
      access.sales && access.expenses
        ? {
            revenue: filsToString(revenueNet),
            expenses: filsToString(expenseNet),
            net: filsToString(revenueNet - expenseNet),
          }
        : null,
    receivables: receivables
      ? {
          balance: receivables.totals.balance,
          count: receivables.totals.count,
          parties: receivables.totals.parties,
          /** Past its due date and still unpaid. */
          overdue: filsToString(
            receivables.rows
              .filter((row) => row.dueDate && localDateString(row.dueDate) < period.to)
              .reduce((sum, row) => sum + row.balanceFils, 0),
          ),
          overdueCount: receivables.rows.filter(
            (row) => row.dueDate && localDateString(row.dueDate) < period.to,
          ).length,
          recent: receivables.rows.slice(0, 5),
        }
      : null,
    payables: payables
      ? {
          balance: payables.totals.balance,
          count: payables.totals.count,
          parties: payables.totals.parties,
          recent: payables.rows.slice(0, 5),
        }
      : null,
    recent,
  };
}

export type FinanceDashboard = Awaited<ReturnType<typeof getFinanceDashboard>>;

/** A short, mixed feed: the last few invoices, payments and expenses. */
async function recentActivity(
  user: AuthenticatedUser,
  access: FinanceAccess,
  branch: Prisma.InvoiceWhereInput,
) {
  const organizationId = user.organizationId;
  const [invoices, payments, expenses] = await Promise.all([
    access.sales
      ? prisma.invoice.findMany({
          where: { organizationId, ...branch, status: { notIn: ['DRAFT', 'VOID', 'CANCELLED'] } },
          orderBy: [{ issueDate: 'desc' }, { invoiceNumber: 'desc' }],
          take: 5,
          select: {
            id: true,
            invoiceNumber: true,
            issueDate: true,
            totalAmount: true,
            status: true,
            customer: { select: { name: true } },
            jobCard: { select: { id: true } },
          },
        })
      : [],
    access.sales
      ? prisma.payment.findMany({
          where: {
            organizationId,
            status: 'COMPLETED',
            invoice: { organizationId, ...branch, status: { notIn: ['VOID', 'CANCELLED'] } },
          },
          orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
          take: 5,
          select: {
            id: true,
            amount: true,
            method: true,
            receivedAt: true,
            invoice: {
              select: {
                invoiceNumber: true,
                jobCardId: true,
                customer: { select: { name: true } },
              },
            },
          },
        })
      : [],
    access.expenses
      ? prisma.expense.findMany({
          where: {
            organizationId,
            ...(user.primaryBranchId ? { branchId: user.primaryBranchId } : {}),
            status: 'RECORDED',
          },
          orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
          take: 5,
          select: {
            id: true,
            description: true,
            amount: true,
            taxAmount: true,
            expenseDate: true,
            chartOfAccount: { select: { accountName: true } },
          },
        })
      : [],
  ]);
  return { invoices, payments, expenses };
}
