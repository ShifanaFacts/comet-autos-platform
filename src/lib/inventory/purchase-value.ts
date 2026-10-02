import type { Prisma } from '@/generated/prisma/client';
import {
  calculateLine,
  filsToString,
  milliToString,
  prorateFils,
  signedToMilli,
  toFils,
} from '@/lib/money';

/*
 * What stock received on a purchase is worth — the one calculation behind
 * the receipt posting, the supplier balance (payables, what is owed, paying
 * a supplier), the supplier statement and the VAT return's purchases.
 *
 * Two kinds of purchase line:
 *
 *   No discount (`netAmount` empty) — every line entered before discounts
 *   existed, and every line of a purchase without one. Valued exactly as it
 *   always was: the quantity at the unit cost, VAT at the line's rate, each
 *   caller rounding where it always rounded. Nothing about these changes.
 *
 *   Discounted (`netAmount` set) — the line's cost after its own discount
 *   and its share of the bill discount, and its VAT on that, are fixed when
 *   the purchase is saved. What is received is valued as its share of them,
 *   CUMULATIVELY: the first q units are worth net × q ÷ ordered, and a
 *   delivery is worth (what was received through it) − (what was received
 *   before it). So deliveries of 4 and then 6 of 10 add up to the line's
 *   cost exactly, to the fil, and a return takes off exactly what the units
 *   it gives back were booked at.
 */

/** A purchase line as valuation needs to see it. */
export interface ValuedLine {
  quantityOrdered: { toString(): string };
  unitCost: { toString(): string };
  taxRate: { toString(): string } | null;
  /** VAT on the whole line, after its discounts. */
  taxAmount: { toString(): string } | null;
  /** The whole line's cost after its discounts; empty when the purchase has none. */
  netAmount: { toString(): string } | null;
}

export interface StockValue {
  /** Cost before VAT, in fils. */
  netFils: number;
  /** Input VAT, in fils. */
  taxFils: number;
}

export const isDiscountedLine = (line: Pick<ValuedLine, 'netAmount'> | null | undefined) =>
  line?.netAmount !== null && line?.netAmount !== undefined;

const fils = (value: { toString(): string } | null) => (value ? toFils(value.toString()) : 0);

/** The first `milli` units of a discounted line: their share of its cost and VAT. */
function shareOf(line: ValuedLine, milli: number): StockValue {
  const ordered = signedToMilli(line.quantityOrdered);
  return {
    netFils: prorateFils(fils(line.netAmount), milli, ordered),
    taxFils: prorateFils(fils(line.taxAmount), milli, ordered),
  };
}

/** `milli` units at `unitCost` and `taxRate` — the valuation before discounts existed. */
function atCost(milli: number, unitCost: string, taxRate: string): StockValue {
  const amounts = calculateLine({ quantity: milliToString(milli), unitPrice: unitCost, taxRate });
  return { netFils: amounts.lineTotalFils, taxFils: amounts.taxFils };
}

/**
 * What has been received on a line is worth — the supplier balance's rule
 * (received value − payments).
 */
export function receivedLineValue(
  line: ValuedLine & { quantityReceived: { toString(): string } },
  defaultVat: string,
): StockValue {
  const received = signedToMilli(line.quantityReceived);
  if (received <= 0) return { netFils: 0, taxFils: 0 };
  if (isDiscountedLine(line)) return shareOf(line, received);
  return atCost(received, line.unitCost.toString(), line.taxRate?.toString() ?? defaultVat);
}

/**
 * Value of what has actually been received on a purchase (cost + VAT, after
 * any discounts), in fils.
 */
export function receivedValueFils(
  items: (ValuedLine & { quantityReceived: { toString(): string } })[],
  defaultVat: string,
) {
  return items.reduce((sum, item) => {
    const value = receivedLineValue(item, defaultVat);
    return sum + value.netFils + value.taxFils;
  }, 0);
}

/**
 * One stock movement on a purchase line — a delivery (positive) or a return
 * (negative) — signed: what it adds to stock and to what is owed.
 *
 * `receivedBeforeMilli` is the line's net quantity from its earlier
 * movements (`receivedBefore` below); only a discounted line needs it.
 * `unitCost` and `taxRate` are the movement's own, used for a line without
 * a discount exactly as before.
 */
export function movementValue(params: {
  line: ValuedLine | null;
  movementMilli: number;
  receivedBeforeMilli: number;
  unitCost: string;
  taxRate: string;
}): StockValue {
  const { line, movementMilli, receivedBeforeMilli } = params;
  if (movementMilli === 0) return { netFils: 0, taxFils: 0 };
  if (line && isDiscountedLine(line)) {
    const through = shareOf(line, receivedBeforeMilli + movementMilli);
    const before = shareOf(line, receivedBeforeMilli);
    return {
      netFils: through.netFils - before.netFils,
      taxFils: through.taxFils - before.taxFils,
    };
  }
  const sign = movementMilli < 0 ? -1 : 1;
  const value = atCost(Math.abs(movementMilli), params.unitCost, params.taxRate);
  return { netFils: sign * value.netFils, taxFils: sign * value.taxFils };
}

/** The movements that change what was received on a purchase line. */
const RECEIVING = ['PURCHASE_RECEIPT', 'RETURN_TO_SUPPLIER'] as const;

/**
 * For each delivery or return on these purchase lines, the line's net
 * quantity from the movements before it (oldest first: by time, then id).
 * Keyed by movement id. One query, whatever the number of lines.
 */
export async function receivedBefore(
  client: Prisma.TransactionClient,
  organizationId: string,
  purchaseItemIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (purchaseItemIds.length === 0) return result;
  const movements = await client.inventoryTransaction.findMany({
    where: {
      organizationId,
      purchaseItemId: { in: [...new Set(purchaseItemIds)] },
      transactionType: { in: [...RECEIVING] },
    },
    select: { id: true, purchaseItemId: true, quantity: true, createdAt: true },
  });
  movements.sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const running = new Map<string, number>();
  for (const movement of movements) {
    const key = movement.purchaseItemId!;
    const before = running.get(key) ?? 0;
    result.set(movement.id, before);
    running.set(key, before + signedToMilli(movement.quantity));
  }
  return result;
}

/**
 * A line's cost per unit after its discounts, rounded half-up to the fil —
 * for updating a part's cost price when asked to. Without a discount it is
 * the unit cost itself.
 */
export function unitCostAfterDiscount(line: ValuedLine): string {
  if (!isDiscountedLine(line)) return filsToString(fils(line.unitCost));
  const ordered = BigInt(signedToMilli(line.quantityOrdered));
  if (ordered <= BigInt(0)) return filsToString(fils(line.unitCost));
  const two = BigInt(2);
  const perUnit = (BigInt(fils(line.netAmount)) * BigInt(1000) * two + ordered) / (ordered * two);
  return filsToString(Number(perUnit));
}
