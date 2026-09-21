import type { InvoiceStatus, PurchaseStatus } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { filsToString, toFils } from '@/lib/money';
import { invoiceBalance } from '@/lib/billing/invoice';
import { receivedValueFils } from '@/lib/inventory/purchases';
import { resolveDefaultVatRate } from '@/lib/tax';

/*
 * What is still owed, in both directions.
 *
 *   Customers owe us  — issued invoices, less the payments that count.
 *   We owe suppliers  — the value of stock actually received on a purchase,
 *                       less the supplier payments that count.
 *
 * Both reuse the same balance helpers the invoice and supplier screens use,
 * so a figure here can never disagree with the document it came from. All
 * arithmetic is integer fils (lib/money) — never floating point.
 *
 * Nothing cancelled counts: VOID and CANCELLED invoices are excluded, as are
 * CANCELLED purchases; a reversed payment stops counting on both sides
 * (paidFils / the reversal filter below). Supplier debt is measured from
 * purchases received, never from what happens to be on the shelf.
 */

/**
 * Invoices that can still carry a balance. VOID and CANCELLED are never
 * debts. PAID is included on purpose: reversing a payment reopens a balance,
 * and every row is filtered on its computed balance below anyway.
 */
const OWING_INVOICE_STATUSES: InvoiceStatus[] = ['ISSUED', 'PARTIALLY_PAID', 'PAID'];
/**
 * A purchase owes money only once something has actually been received.
 * CANCELLED and REVERSED receipts are not debts.
 */
const RECEIVED_PURCHASE_STATUSES: PurchaseStatus[] = ['RECEIVED', 'PARTIALLY_RECEIVED'];

export interface OutstandingFilters {
  /** Party name, document number or phone. */
  query?: string;
  /** Only rows older than this many days. */
  olderThanDays?: number;
}

/** Whole days between a date and today, floored at zero. */
function ageInDays(date: Date): number {
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
}

/** Oldest first: the debts that need chasing are the ones at the top. */
const byOldest = <T extends { ageDays: number }>(a: T, b: T) => b.ageDays - a.ageDays;

/**
 * Invoices customers have not settled. Branch-scoped for a user tied to one
 * branch, so a branch manager sees their own receivables.
 */
export async function getCustomerOutstanding(
  user: AuthenticatedUser,
  filters: OutstandingFilters = {},
) {
  requirePermission(user, 'invoice.view');
  const q = filters.query?.trim();

  const invoices = await prisma.invoice.findMany({
    where: {
      organizationId: user.organizationId,
      ...(user.primaryBranchId ? { branchId: user.primaryBranchId } : {}),
      status: { in: OWING_INVOICE_STATUSES },
      ...(q
        ? {
            OR: [
              { invoiceNumber: { contains: q, mode: 'insensitive' } },
              { customer: { name: { contains: q, mode: 'insensitive' } } },
              { customer: { phone: { contains: q } } },
            ],
          }
        : {}),
    },
    orderBy: [{ issueDate: 'asc' }, { invoiceNumber: 'asc' }],
    take: 500,
    select: {
      id: true,
      invoiceNumber: true,
      issueDate: true,
      dueDate: true,
      status: true,
      totalAmount: true,
      customer: { select: { id: true, name: true, phone: true } },
      jobCard: { select: { id: true, jobNumber: true } },
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

  const rows = invoices
    .map((invoice) => {
      const money = invoiceBalance(invoice);
      return {
        id: invoice.id,
        number: invoice.invoiceNumber,
        date: invoice.issueDate,
        dueDate: invoice.dueDate,
        party: invoice.customer,
        jobCard: invoice.jobCard,
        total: money.total,
        paid: money.paid,
        balance: money.balance,
        balanceFils: toFils(money.balance),
        state: money.state,
        ageDays: ageInDays(invoice.issueDate),
      };
    })
    // A fully-settled invoice whose status lags behind is not a debt.
    .filter((row) => row.balanceFils > 0)
    .filter((row) => !filters.olderThanDays || row.ageDays >= filters.olderThanDays)
    .sort(byOldest);

  return { rows, totals: summarise(rows) };
}

export type CustomerOutstandingRow = Awaited<
  ReturnType<typeof getCustomerOutstanding>
>['rows'][number];

/**
 * What the workshop still owes on purchases it has received. Measured from
 * the purchase, not from stock on hand: parts already fitted to a car are
 * still owed for.
 */
export async function getSupplierOutstanding(
  user: AuthenticatedUser,
  filters: OutstandingFilters = {},
) {
  requirePermission(user, 'inventory.view');
  const q = filters.query?.trim();
  const defaultVat = await resolveDefaultVatRate(user.organizationId);

  const purchases = await prisma.purchase.findMany({
    where: {
      organizationId: user.organizationId,
      ...(user.primaryBranchId ? { branchId: user.primaryBranchId } : {}),
      status: { in: RECEIVED_PURCHASE_STATUSES },
      ...(q
        ? {
            OR: [
              { purchaseNumber: { contains: q, mode: 'insensitive' } },
              { supplierInvoiceNumber: { contains: q, mode: 'insensitive' } },
              { supplier: { name: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'asc' }],
    take: 500,
    select: {
      id: true,
      purchaseNumber: true,
      supplierInvoiceNumber: true,
      supplierInvoiceDate: true,
      createdAt: true,
      status: true,
      supplier: { select: { id: true, name: true, phone: true } },
      items: { select: { quantityReceived: true, unitCost: true, taxRate: true } },
      supplierPayments: {
        select: { id: true, amount: true, status: true, reversalOfSupplierPaymentId: true },
      },
    },
  });

  const rows = purchases
    .map((purchase) => {
      const receivedFils = receivedValueFils(purchase.items, defaultVat);
      // Same rule as customer payments: a reversed payment stops counting.
      const reversed = new Set(
        purchase.supplierPayments
          .map((payment) => payment.reversalOfSupplierPaymentId)
          .filter(Boolean),
      );
      const paid = purchase.supplierPayments
        .filter(
          (payment) =>
            payment.status === 'COMPLETED' &&
            !payment.reversalOfSupplierPaymentId &&
            !reversed.has(payment.id),
        )
        .reduce((sum, payment) => sum + toFils(payment.amount.toString()), 0);
      const balanceFils = Math.max(receivedFils - paid, 0);
      const date = purchase.supplierInvoiceDate ?? purchase.createdAt;
      return {
        id: purchase.id,
        number: purchase.purchaseNumber,
        supplierInvoiceNumber: purchase.supplierInvoiceNumber,
        date,
        party: purchase.supplier,
        total: filsToString(receivedFils),
        paid: filsToString(paid),
        balance: filsToString(balanceFils),
        balanceFils,
        state: (paid === 0 ? 'UNPAID' : balanceFils > 0 ? 'PARTIALLY_PAID' : 'PAID') as
          'UNPAID' | 'PARTIALLY_PAID' | 'PAID',
        ageDays: ageInDays(date),
      };
    })
    .filter((row) => row.balanceFils > 0)
    .filter((row) => !filters.olderThanDays || row.ageDays >= filters.olderThanDays)
    .sort(byOldest);

  return { rows, totals: summarise(rows) };
}

export type SupplierOutstandingRow = Awaited<
  ReturnType<typeof getSupplierOutstanding>
>['rows'][number];

/** Totals and simple ageing buckets, in exact money. */
function summarise(rows: { balanceFils: number; ageDays: number; party: { id: string } }[]) {
  const bucket = (from: number, to?: number) =>
    rows
      .filter((row) => row.ageDays >= from && (to === undefined || row.ageDays <= to))
      .reduce((sum, row) => sum + row.balanceFils, 0);
  return {
    balance: filsToString(rows.reduce((sum, row) => sum + row.balanceFils, 0)),
    count: rows.length,
    parties: new Set(rows.map((row) => row.party.id)).size,
    ageing: {
      current: filsToString(bucket(0, 30)),
      thirty: filsToString(bucket(31, 60)),
      sixty: filsToString(bucket(61, 90)),
      ninety: filsToString(bucket(91)),
    },
  };
}
