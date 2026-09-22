import { filsToString, toFils } from '@/lib/money';
import { receivedValueFils } from '@/lib/inventory/purchases';

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
    items: {
      quantityReceived: { toString(): string };
      unitCost: { toString(): string };
      taxRate: { toString(): string } | null;
    }[];
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
  items: { select: { quantityReceived: true, unitCost: true, taxRate: true } },
  supplierPayments: {
    select: { id: true, amount: true, status: true, reversalOfSupplierPaymentId: true },
  },
} as const;

/** A purchase owes money only once something has been received. */
export const RECEIVED_PURCHASE_STATUSES = ['RECEIVED', 'PARTIALLY_RECEIVED'] as const;
