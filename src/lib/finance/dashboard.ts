import type { InvoiceStatus, Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { AuthError, hasPermission } from '@/lib/auth/authorize';
import { filsToString, toFils } from '@/lib/money';
import { invoiceBalance } from '@/lib/billing/invoice';
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

export type PeriodKey =
  'today' | 'week' | 'month' | 'last-month' | 'quarter' | 'last-quarter' | 'year' | 'custom';

export interface ResolvedPeriod {
  key: PeriodKey;
  label: string;
  /** Inclusive Dubai calendar dates, "YYYY-MM-DD". */
  from: string;
  to: string;
  /**
   * The last day of the calendar period itself, "YYYY-MM-DD". For a period
   * still running ("This quarter") `to` is today — the figures stop there —
   * but anything measured from the period's end, like a VAT return's due
   * date, is measured from this.
   */
  periodEnd: string;
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
/** The first day of a month, "YYYY-MM-01"; months outside 1–12 roll over the year. */
const monthStart = (year: number, month: number) => {
  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toISOString().slice(0, 10);
};

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
  let periodEnd = today;
  let label = '';
  const [year, month] = today.split('-').map(Number);

  if (input.period === 'today') {
    key = 'today';
    label = 'Today';
  } else if (input.period === 'week') {
    key = 'week';
    // The workshop week starts on Monday.
    const weekday = (asInstant(today).getUTCDay() + 6) % 7;
    from = addDays(today, -weekday);
    periodEnd = addDays(from, 6);
    label = 'This week';
  } else if (input.period === 'last-month') {
    key = 'last-month';
    from = monthStart(year, month - 1);
    to = addDays(monthStart(year, month), -1);
    periodEnd = to;
    label = 'Last month';
  } else if (input.period === 'quarter' || input.period === 'last-quarter') {
    // Calendar quarters — the periods a UAE VAT return is usually filed for.
    key = input.period;
    const first = month - ((month - 1) % 3) - (key === 'last-quarter' ? 3 : 0);
    from = monthStart(year, first);
    periodEnd = addDays(monthStart(year, first + 3), -1);
    if (key === 'last-quarter') to = periodEnd;
    label = key === 'quarter' ? 'This quarter' : 'Last quarter';
  } else if (input.period === 'year') {
    key = 'year';
    from = `${year}-01-01`;
    periodEnd = `${year}-12-31`;
    label = 'This year';
  } else if (
    input.period === 'custom' &&
    DATE_ONLY.test(input.from ?? '') &&
    DATE_ONLY.test(input.to ?? '')
  ) {
    key = 'custom';
    from = input.from!;
    to = input.to!;
    if (from > to) [from, to] = [to, from];
    periodEnd = to;
    label = 'Custom range';
  } else {
    from = `${today.slice(0, 7)}-01`;
    periodEnd = addDays(monthStart(year, month + 1), -1);
    label = 'This month';
  }

  return {
    key,
    label,
    from,
    to,
    periodEnd,
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
    expenses: hasPermission(user, 'expense.view', scope),
    payables: hasPermission(user, 'supplier_payment.view', scope),
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

      // --- Collected: the payments that actually count, in this window. A
      // reversed payment keeps status COMPLETED — its reversal is a separate
      // REVERSED row — so "counts" means: completed, not itself a reversal,
      // and never reversed (whenever the reversal happened).
      access.sales
        ? prisma.payment.aggregate({
            where: {
              organizationId,
              status: 'COMPLETED',
              reversalOfPaymentId: null,
              reversals: { none: {} },
              receivedAt: { gte: period.start, lt: period.end },
              invoice: { organizationId, ...branch, status: { notIn: ['VOID', 'CANCELLED'] } },
            },
            _sum: { amount: true },
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

  const collectedFils = toFils(collected?._sum.amount?.toString() ?? '0');
  const settlement = access.sales ? await settlementOf(organizationId, branch, dateWindow) : null;

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
          settlement,
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
            // Money that stands: not a reversal, and not since reversed.
            reversalOfPaymentId: null,
            reversals: { none: {} },
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

/**
 * Where the money stands on the invoices issued in the period — one set of
 * invoices, so it always balances:
 *
 *   invoiced (incl. VAT) = received + advances applied + credited
 *                          + discounts given after the invoice + still due
 *
 * "Received" here is every payment on those invoices, whenever it came in;
 * the Collected figure is the period's cash instead, on any invoice.
 */
async function settlementOf(
  organizationId: string,
  branch: Prisma.InvoiceWhereInput,
  issueDate: { gte: Date; lte: Date },
) {
  const invoices = await prisma.invoice.findMany({
    where: { organizationId, ...branch, status: { in: REVENUE_STATUSES }, issueDate },
    select: {
      status: true,
      totalAmount: true,
      creditedAmount: true,
      advanceAppliedAmount: true,
      settlementDiscount: true,
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
  });
  const sum = { invoiced: 0, received: 0, advances: 0, credited: 0, discounts: 0, due: 0 };
  for (const invoice of invoices) {
    const balance = invoiceBalance(invoice);
    sum.invoiced += toFils(balance.total);
    sum.received += toFils(balance.paid);
    sum.advances += toFils(balance.advanceApplied);
    sum.credited += toFils(balance.credited);
    sum.discounts += toFils(balance.discount);
    sum.due += toFils(balance.balance);
  }
  // Paid beyond what was due (returned to an advance under a credit note) would
  // make the parts exceed the whole; shown so the page can say so, never hidden.
  const accounted = sum.received + sum.advances + sum.credited + sum.discounts + sum.due;
  return {
    invoiced: filsToString(sum.invoiced),
    received: filsToString(sum.received),
    advancesApplied: filsToString(sum.advances),
    credited: filsToString(sum.credited),
    discounts: filsToString(sum.discounts),
    due: filsToString(sum.due),
    accounted: filsToString(accounted),
    balanced: accounted === sum.invoiced,
  };
}
