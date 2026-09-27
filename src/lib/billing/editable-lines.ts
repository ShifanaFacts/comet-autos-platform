import { formatMilli, signedToMilli, type DiscountType } from '@/lib/money';

/*
 * A quotation or invoice line as the line editor holds it while it is being
 * typed (components/workshop/document-lines-editor.tsx), and how a saved
 * line or bill discount is turned back into one to be edited again.
 *
 * Plain data and functions, so server pages can prepare the editor's
 * starting values and the editor can use the same shapes.
 */

export type LineType = 'PART' | 'LABOUR';

export interface EditableLine {
  key: string;
  itemType: LineType;
  description: string;
  quantity: string;
  unitPrice: string;
  /** Percent; defaults to the organization's rate. */
  taxRate: string;
  /** The line's discount: a percentage or an AED amount; blank for none. */
  discountType: DiscountType;
  discount: string;
}

/** A discount on the whole bill, as typed. Blank for none. */
export interface BillDiscount {
  type: DiscountType;
  value: string;
}

type Stored = { toString(): string };

/** "2.500" → "2.5", "5.00" → "5": a stored figure as a person would type it. */
function typed(value: Stored): string {
  return formatMilli(signedToMilli(value.toString()));
}

/** A saved line, ready to edit again. */
export function editableLine(
  item: {
    itemType: string | null;
    description: string;
    quantity: Stored;
    unitPrice: Stored;
    taxRate: Stored | null;
    discountType: DiscountType | null;
    discountValue: Stored | null;
  },
  key: string,
  defaultVatRate: string,
): EditableLine {
  return {
    key,
    itemType: item.itemType === 'LABOUR' ? 'LABOUR' : 'PART',
    description: item.description,
    quantity: typed(item.quantity),
    unitPrice: item.unitPrice.toString(),
    taxRate: typed(item.taxRate ?? defaultVatRate),
    discountType: item.discountType ?? 'PERCENT',
    discount: item.discountValue ? typed(item.discountValue) : '',
  };
}

/** A saved bill discount, ready to edit again. */
export function editableBill(document: {
  discountType: DiscountType | null;
  discountValue: Stored | null;
}): BillDiscount {
  return {
    type: document.discountType ?? 'PERCENT',
    value: document.discountValue ? typed(document.discountValue) : '',
  };
}
