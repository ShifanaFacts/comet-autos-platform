import { z } from 'zod';
import type { EstimateItemType } from '@/generated/prisma/enums';
import { DomainError } from '@/lib/errors';
import {
  calculateDocument,
  calculateLine,
  filsToString,
  readDiscount,
  toFils,
  type DiscountType,
  type DocumentTotals,
  type LineAmounts,
} from '@/lib/money';

/*
 * The lines of a quotation or an invoice as a form sends them, and how they
 * are priced and stored. One set of rules for every document typed on
 * screen — a new invoice, a corrected one, a quotation — so they can't
 * price the same lines differently.
 *
 * Each line may carry a discount of its own, and the whole bill one more
 * (lib/money calculateDocument). Figures from the browser are never used:
 * every line is priced again here from its quantity, price, VAT rate and
 * discount as entered.
 */

const DISCOUNT_TYPES = ['PERCENT', 'AMOUNT'] as const;

/** A discount as a form sends it: a percentage or an amount, and its value. */
export const discountFields = {
  discountType: z.enum(DISCOUNT_TYPES).optional(),
  discount: z.string().trim().max(20, 'Enter a shorter discount.').optional(),
};

export const lineSchema = z.object({
  /** Parts or labour — printed in the document's TYPE column. */
  itemType: z.enum(['PART', 'LABOUR'], { error: 'Choose parts or labour for every line.' }),
  description: z
    .string({ error: 'Every line needs a description.' })
    .trim()
    .min(1, 'Every line needs a description.')
    .max(300, 'Keep a line description under 300 characters.'),
  quantity: z.string().trim().min(1, 'Enter a quantity.'),
  unitPrice: z.string().trim().min(1, 'Enter a price.'),
  taxRate: z.string().trim().optional(),
  ...discountFields,
});

export type TypedLine = z.infer<typeof lineSchema>;

export interface PricedLine {
  itemType: EstimateItemType;
  description: string;
  amounts: LineAmounts;
}

/**
 * Prices typed lines and the bill discount through lib/money. A line that
 * doesn't add up is reported against that line; a bill discount that
 * doesn't, against the discount.
 */
export function priceDocument(
  items: TypedLine[],
  defaultVatRate: string,
  bill: { discountType?: DiscountType; discount?: string },
): { lines: PricedLine[]; totals: DocumentTotals } {
  const lines = items.map((item, index) => {
    try {
      return {
        itemType: item.itemType as EstimateItemType,
        description: item.description,
        amounts: calculateLine({
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRate: item.taxRate || defaultVatRate,
          discount: readDiscount(item.discountType, item.discount),
        }),
      };
    } catch (error) {
      throw new DomainError(
        `Line ${index + 1}: ${error instanceof Error ? error.message : 'invalid amount.'}`,
        `items.${index}`,
      );
    }
  });
  return withBillDiscount(lines, readDiscount(bill.discountType, bill.discount));
}

/** Applies a bill discount to priced lines (each keeps its own discount). */
export function withBillDiscount<Line extends { amounts: LineAmounts }>(
  lines: Line[],
  discount: ReturnType<typeof readDiscount>,
): { lines: Line[]; totals: DocumentTotals } {
  try {
    const priced = calculateDocument(
      lines.map((line) => line.amounts),
      discount,
    );
    return {
      lines: lines.map((line, index) => ({ ...line, amounts: priced.lines[index] })),
      totals: priced.totals,
    };
  } catch (error) {
    throw new DomainError(
      error instanceof Error ? error.message : 'Check the discount.',
      'discount',
    );
  }
}

/** A priced line's columns, as stored on a quotation or invoice line. */
export function lineData(amounts: LineAmounts) {
  return {
    quantity: amounts.quantity,
    unitPrice: amounts.unitPrice,
    discountType: amounts.discountType,
    discountValue: amounts.discountValue,
    discountAmount: amounts.discountAmount,
    lineTotal: amounts.lineTotal,
    taxRate: amounts.taxRate,
    taxAmount: amounts.taxAmount,
  };
}

/** A document's totals columns, as stored on a quotation or invoice. */
export function totalsData(totals: DocumentTotals) {
  return {
    discountType: totals.discountType,
    discountValue: totals.discountValue,
    discountAmount: totals.discountAmount,
    subtotal: totals.subtotal,
    taxAmount: totals.taxAmount,
    totalAmount: totals.totalAmount,
  };
}

type Stored = { toString(): string };

/**
 * A stored line's figures, exactly as saved — for carrying a quotation's
 * lines onto an invoice without pricing them again.
 */
export function storedLineAmounts(item: {
  quantity: Stored;
  unitPrice: Stored;
  discountType: DiscountType | null;
  discountValue: Stored | null;
  discountAmount: Stored;
  lineTotal: Stored;
  taxRate: Stored | null;
  taxAmount: Stored | null;
}): LineAmounts {
  const lineTotal = item.lineTotal.toString();
  const taxAmount = (item.taxAmount ?? 0).toString();
  return {
    quantity: item.quantity.toString(),
    unitPrice: item.unitPrice.toString(),
    discountType: item.discountType,
    discountValue: item.discountValue?.toString() ?? null,
    discountAmount: item.discountAmount.toString(),
    lineTotal,
    taxRate: (item.taxRate ?? 0).toString(),
    taxAmount,
    lineTotalFils: toFils(lineTotal),
    taxFils: toFils(taxAmount),
  };
}

/** A stored document's totals, exactly as saved. */
export function storedTotals(document: {
  discountType: DiscountType | null;
  discountValue: Stored | null;
  discountAmount: Stored;
  subtotal: Stored;
  taxAmount: Stored;
  totalAmount: Stored;
}): DocumentTotals {
  const discountAmount = document.discountAmount.toString();
  const subtotal = document.subtotal.toString();
  return {
    linesTotal: filsToString(toFils(subtotal) + toFils(discountAmount)),
    discountType: document.discountType,
    discountValue: document.discountValue?.toString() ?? null,
    discountAmount,
    subtotal,
    taxAmount: document.taxAmount.toString(),
    totalAmount: document.totalAmount.toString(),
  };
}
