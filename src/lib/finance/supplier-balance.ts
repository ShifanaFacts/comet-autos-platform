import { filsToString, toFils } from '@/lib/money';
import { formatCalendarDate } from '@/lib/format';
import { receivedValueFils, type ValuedLine } from '@/lib/inventory/purchase-value';

/*
 * What the workshop owes on a purchase — the one definition.
 *
 * Before this, the same arithmetic was written out in three places (the
 * payables list, the supplier directory and the outstanding screen). They
 * agreed, but only by being copied carefully. They now agree because there
 * is one of them, and recording a payment reads the same figure the screens
 * show — so a balance can never drift from what was actually paid.
 *
 * The rule:
 *
 *   owed = value of stock actually received  −  the payments that count
 *
 * "Value" is after any purchase discounts, valued by the same rule as the
 * books (lib/inventory/purchase-value.ts).
 *
 * Measured from the purchase, never from stock on hand: parts already fitted
 * to a customer's car are still owed for. All arithmetic is integer fils.
 */

/** A supplier payment as the balance rule needs to see it. */
export interface SupplierPaymentLike {
  id: string;
  amount: { toString(): string };
  status: string;
  reversalOfSupplierPaymentId: string | null;
}

/**
 * The payments on a purchase that still count, in fils.
 *
 * A reversal cancels a payment, so **both rows drop out**: the original is
 * no longer money paid, and the reversal is not a second payment. Anything
 * not COMPLETED never counted in the first place.
 */
export function supplierPaidFils(payments: SupplierPaymentLike[]): number {
  const reversed = new Set(
    payments.map((payment) => payment.reversalOfSupplierPaymentId).filter(Boolean),
  );
  return payments
    .filter(
      (payment) =>
        payment.status === 'COMPLETED' &&
        !payment.reversalOfSupplierPaymentId &&
        !reversed.has(payment.id),
    )
    .reduce((sum, payment) => sum + toFils(payment.amount.toString()), 0);
}

export type PurchasePaymentState = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

export interface PurchaseBalance {
  receivedFils: number;
  paidFils: number;
  balanceFils: number;
  received: string;
  paid: string;
  balance: string;
  state: PurchasePaymentState;
}

/**
 * Received value, paid and still owed for one purchase.
 *
 * The balance floors at zero: an overpayment is refused when it is recorded,
 * so a negative balance would mean the data was changed outside the system —
 * and a screen showing "we are owed money by our supplier" would be a worse
 * lie than showing nothing outstanding.
 */
export function purchaseBalance(
  purchase: {
    items: (ValuedLine & { quantityReceived: { toString(): string } })[];
    supplierPayments: SupplierPaymentLike[];
  },
  defaultVat: string,
): PurchaseBalance {
  const receivedFils = receivedValueFils(purchase.items, defaultVat);
  const paidFils = supplierPaidFils(purchase.supplierPayments);
  const balanceFils = Math.max(receivedFils - paidFils, 0);
  return {
    receivedFils,
    paidFils,
    balanceFils,
    received: filsToString(receivedFils),
    paid: filsToString(paidFils),
    balance: filsToString(balanceFils),
    state: paidFils === 0 ? 'UNPAID' : balanceFils > 0 ? 'PARTIALLY_PAID' : 'PAID',
  };
}

/** The `select` every caller needs for `purchaseBalance` to be computable. */
export const PURCHASE_BALANCE_SELECT = {
  items: {
    select: {
      quantityReceived: true,
      quantityOrdered: true,
      unitCost: true,
      taxRate: true,
      taxAmount: true,
      netAmount: true,
    },
  },
  supplierPayments: {
    select: { id: true, amount: true, status: true, reversalOfSupplierPaymentId: true },
  },
} as const;

/**
 * How old a supplier's bill is, for Suppliers owed — one rule for every
 * screen that ages them.
 *
 * Without a due date: whole days since the bill's date, exactly as before
 * (the screens treat 31 days and more as overdue).
 *
 * With a due date (the supplier's "pay later" terms): aged from it, on the
 * same buckets — counted so the day after it is due is day 31, the first
 * overdue day — and `daysOverdue` says by how much in plain days.
 */
export function payableAge(billDate: Date, dueDate: Date | null, now = Date.now()) {
  const daysSince = (date: Date) => Math.floor((now - date.getTime()) / 86_400_000);
  if (!dueDate) {
    return { ageDays: Math.max(0, daysSince(billDate)), dueDate: null, daysOverdue: null };
  }
  const pastDue = daysSince(dueDate);
  return {
    ageDays: Math.max(0, pastDue + 30),
    dueDate,
    daysOverdue: Math.max(0, pastDue),
  };
}

/** A bill's age in words: "12 days old", or with a due date "due 30 Oct 2026" / "5 days overdue". */
export function payableAgeLabel(row: {
  ageDays: number;
  dueDate: Date | null;
  daysOverdue: number | null;
}) {
  if (!row.dueDate) return `${row.ageDays} days old`;
  if (row.daysOverdue && row.daysOverdue > 0) {
    return `${row.daysOverdue} day${row.daysOverdue === 1 ? '' : 's'} overdue`;
  }
  return `due ${formatCalendarDate(row.dueDate)}`;
}

/** A purchase owes money only once something has been received. */
export const RECEIVED_PURCHASE_STATUSES = ['RECEIVED', 'PARTIALLY_RECEIVED'] as const;
