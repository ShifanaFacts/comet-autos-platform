/**
 * Exact money arithmetic for estimates. All amounts are handled as integer
 * fils (1 AED = 100 fils) and quantities as integer thousandths, so totals
 * never suffer floating-point drift. Values are passed to Prisma as decimal
 * strings, which it stores in Decimal(14,2) / Decimal(12,3) columns exactly.
 */

// No default VAT rate lives here: callers always pass the rate (see lib/tax.ts).

function parseScaled(value: string | number, scale: number, label: string): number {
  const text = String(value).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`${label} must be a positive number.`);
  const [, whole, fraction = ''] = match;
  if (fraction.length > scale) throw new Error(`${label} allows at most ${scale} decimal places.`);
  const scaled = Number(whole) * 10 ** scale + Number(fraction.padEnd(scale, '0') || '0');
  if (!Number.isSafeInteger(scaled)) throw new Error(`${label} is too large.`);
  return scaled;
}

export const toFils = (value: string | number, label = 'Amount') => parseScaled(value, 2, label);
export const toMilli = (value: string | number, label = 'Quantity') => parseScaled(value, 3, label);

/** Half-up rounding of a non-negative integer division. */
function divRound(numerator: number, denominator: number): number {
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

export function filsToString(fils: number): string {
  const sign = fils < 0 ? '-' : '';
  const abs = Math.abs(fils);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function milliToString(milli: number): string {
  return `${Math.floor(milli / 1000)}.${String(milli % 1000).padStart(3, '0')}`;
}

/** How a discount was entered: a percentage of the amount, or a fixed amount. */
export type DiscountType = 'PERCENT' | 'AMOUNT';

export interface Discount {
  type: DiscountType;
  /** "10" (percent) or "25.00" (AED), as entered. */
  value: string;
}

/**
 * The discount a form gave, or null for none: no type, a blank value or
 * zero all mean no discount. The value itself is checked when it is used.
 */
export function readDiscount(
  type: string | null | undefined,
  value: { toString(): string } | null | undefined,
): Discount | null {
  const text = value?.toString().trim() ?? '';
  if (type !== 'PERCENT' && type !== 'AMOUNT') return null;
  if (!text || /^0*\.?0*$/.test(text)) return null;
  return { type, value: text };
}

/**
 * A discount off `baseFils`, in fils: a percentage rounded half-up to the
 * fil, or a fixed amount that may not exceed what it is taken off.
 */
export function discountFils(baseFils: number, discount: Discount, label = 'Discount'): number {
  if (discount.type === 'PERCENT') {
    const hundredths = parseScaled(discount.value, 2, label);
    if (hundredths > 10000) throw new Error(`${label} cannot exceed 100%.`);
    return divRound(baseFils * hundredths, 10000);
  }
  const fils = toFils(discount.value, label);
  if (fils > baseFils) throw new Error(`${label} cannot be more than the amount it is taken off.`);
  return fils;
}

/**
 * `fils` × part ÷ whole, rounded half-up to the fil — a fixed amount scaled to
 * a share of what it was for, e.g. a line's discount when only part of the
 * line is billed. BigInt, because the product can pass 2^53.
 */
export function prorateFils(fils: number, part: number, whole: number): number {
  if (whole <= 0 || part <= 0) return 0;
  if (part >= whole) return fils;
  const two = BigInt(2);
  return Number((BigInt(fils) * BigInt(part) * two + BigInt(whole)) / (BigInt(whole) * two));
}

/** A discount as stored: null when none was given, else its value normalised. */
function storedDiscount(discount: Discount | null | undefined, fils: number) {
  if (!discount) return { discountType: null, discountValue: null, discountAmount: '0.00' };
  return {
    discountType: discount.type,
    discountValue: filsToString(toFils(discount.value)),
    discountAmount: filsToString(fils),
  };
}

export interface LineInput {
  quantity: string;
  unitPrice: string;
  /** Percent, e.g. "5" or "5.00". */
  taxRate: string;
  /** The line's own discount, if any. */
  discount?: Discount | null;
}

export interface LineAmounts {
  quantity: string;
  unitPrice: string;
  /** The line's own discount as entered, and the AED it came to ("0.00" for none). */
  discountType: DiscountType | null;
  discountValue: string | null;
  discountAmount: string;
  /** Quantity × price, less the line's own discount. */
  lineTotal: string;
  taxRate: string;
  /** VAT on the line — after its share of any bill discount, once one is applied. */
  taxAmount: string;
  lineTotalFils: number;
  taxFils: number;
}

export function calculateLine(input: LineInput): LineAmounts {
  const qty = toMilli(input.quantity);
  const price = toFils(input.unitPrice, 'Unit price');
  const rateHundredths = parseScaled(input.taxRate, 2, 'VAT rate');
  if (qty === 0) throw new Error('Quantity must be greater than zero.');
  if (rateHundredths > 10000) throw new Error('VAT rate cannot exceed 100%.');

  const grossFils = divRound(qty * price, 1000);
  const offFils = input.discount ? discountFils(grossFils, input.discount) : 0;
  const lineTotalFils = grossFils - offFils;
  const taxFils = divRound(lineTotalFils * rateHundredths, 10000);
  return {
    quantity: milliToString(qty),
    unitPrice: filsToString(price),
    ...storedDiscount(input.discount, offFils),
    lineTotal: filsToString(lineTotalFils),
    taxRate: filsToString(rateHundredths),
    taxAmount: filsToString(taxFils),
    lineTotalFils,
    taxFils,
  };
}

/** Subtotal = Σ line totals, VAT = Σ per-line VAT (each rounded per line), Total = Subtotal + VAT. */
export function calculateTotals(lines: LineAmounts[]) {
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotalFils, 0);
  const tax = lines.reduce((sum, line) => sum + line.taxFils, 0);
  return {
    subtotal: filsToString(subtotal),
    taxAmount: filsToString(tax),
    totalAmount: filsToString(subtotal + tax),
  };
}

export interface DocumentTotals {
  /** Σ line totals — each already net of its own discount. */
  linesTotal: string;
  /** The bill discount as entered, and the AED it came to ("0.00" for none). */
  discountType: DiscountType | null;
  discountValue: string | null;
  discountAmount: string;
  /** The taxable amount: lines total less the bill discount. */
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
}

/**
 * Shares `fils` across weights (a bill discount across line totals) in
 * proportion. Largest remainder: each exact share rounded down, the fils left
 * over going to the weights that lost the most to rounding, so the shares add
 * up to `fils` exactly. BigInt, because amount × weight can pass 2^53.
 */
export function shareFils(fils: number, weights: number[]): number[] {
  const total = BigInt(weights.reduce((sum, weight) => sum + weight, 0) || 1);
  const exact = weights.map((weight) => BigInt(fils) * BigInt(weight));
  const shares = exact.map((value) => Number(value / total));
  let leftover = fils - shares.reduce((sum, share) => sum + share, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value % total }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    );
  for (const { index } of byRemainder) {
    if (leftover <= 0) break;
    shares[index] += 1;
    leftover -= 1;
  }
  return shares;
}

/**
 * Prices a whole quotation or invoice: its lines (each with any discount of
 * its own, from calculateLine) and a discount on the whole bill.
 *
 * VAT is due on what the customer actually pays, so the bill discount is
 * shared across the lines in proportion to their totals — the shares adding
 * up to the discount exactly, to the fil — and each line's VAT is worked out
 * on what is left, at its own rate. The lines come back with that VAT.
 */
export function calculateDocument(
  lines: LineAmounts[],
  discount?: Discount | null,
): { lines: LineAmounts[]; totals: DocumentTotals } {
  const linesTotalFils = lines.reduce((sum, line) => sum + line.lineTotalFils, 0);
  const billFils = discount ? discountFils(linesTotalFils, discount, 'Bill discount') : 0;
  const shares = shareFils(
    billFils,
    lines.map((line) => line.lineTotalFils),
  );

  const priced = lines.map((line, index) => {
    if (!billFils) return line;
    const rateHundredths = parseScaled(line.taxRate, 2, 'VAT rate');
    const taxFils = divRound((line.lineTotalFils - shares[index]) * rateHundredths, 10000);
    return { ...line, taxAmount: filsToString(taxFils), taxFils };
  });

  const subtotalFils = linesTotalFils - billFils;
  const taxFils = priced.reduce((sum, line) => sum + line.taxFils, 0);
  const bill = storedDiscount(discount, billFils);
  return {
    lines: priced,
    totals: {
      linesTotal: filsToString(linesTotalFils),
      ...bill,
      subtotal: filsToString(subtotalFils),
      taxAmount: filsToString(taxFils),
      totalAmount: filsToString(subtotalFils + taxFils),
    },
  };
}

/**
 * Billable labour: hours (2 decimals) × hourly rate, rounded half-up to the
 * fil. Always computed on the server — a total sent from the browser is
 * never trusted.
 */
export function calculateLabour(input: { hours: string; rate: string }) {
  const hundredthHours = parseScaled(input.hours, 2, 'Hours');
  const rateFils = toFils(input.rate, 'Rate');
  if (hundredthHours === 0) throw new Error('Hours must be greater than zero.');
  const amountFils = divRound(hundredthHours * rateFils, 100);
  return {
    hours: filsToString(hundredthHours),
    rate: filsToString(rateFils),
    amount: filsToString(amountFils),
    amountFils,
  };
}

/** Quantity (3 decimals) × unit price, rounded half-up to the fil. */
export function multiplyQuantity(quantity: string, unitPrice: string): number {
  return divRound(toMilli(quantity) * toFils(unitPrice, 'Price'), 1000);
}

/** A signed decimal string ("-2.500", "12") → integer thousandths. */
export function signedToMilli(value: { toString(): string } | null | undefined): number {
  const text = (value ?? '0').toString().trim();
  const negative = text.startsWith('-');
  const milli = toMilli(negative ? text.slice(1) : text);
  return negative ? -milli : milli;
}

/** Integer thousandths → a trimmed decimal string for display ("2.5", "12"). */
export function formatMilli(milli: number): string {
  const sign = milli < 0 ? '-' : '';
  const text = milliToString(Math.abs(milli));
  return sign + (text.includes('.') ? text.replace(/\.?0+$/, '') : text);
}
