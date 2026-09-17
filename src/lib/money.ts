/**
 * Exact money arithmetic for estimates. All amounts are handled as integer
 * fils (1 AED = 100 fils) and quantities as integer thousandths, so totals
 * never suffer floating-point drift. Values are passed to Prisma as decimal
 * strings, which it stores in Decimal(14,2) / Decimal(12,3) columns exactly.
 */

/** UAE standard VAT rate, applied as the default per line. */
export const DEFAULT_VAT_RATE = '5.00';

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

export interface LineInput {
  quantity: string;
  unitPrice: string;
  /** Percent, e.g. "5" or "5.00". */
  taxRate: string;
}

export interface LineAmounts {
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  taxRate: string;
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

  const lineTotalFils = divRound(qty * price, 1000);
  const taxFils = divRound(lineTotalFils * rateHundredths, 10000);
  return {
    quantity: milliToString(qty),
    unitPrice: filsToString(price),
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
