/**
 * Input normalization shared by every write path and every search, so the
 * same vehicle/customer can't be entered twice just because of spacing or
 * formatting differences.
 */

/** "a  12345 " -> "A 12345". Registration comparisons are case-insensitive and whitespace-collapsed. */
export function normalizePlate(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

/** Plate with all whitespace removed, for fuzzy matching ("A12345" finds "A 12345"). */
export function compactPlate(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

/** VINs are stored uppercase without spaces; empty becomes null. */
export function normalizeVin(value: string | null | undefined): string | null {
  const compact = (value ?? '').replace(/\s+/g, '').toUpperCase();
  return compact.length > 0 ? compact : null;
}

/** Keeps a readable phone format but trims and collapses whitespace. */
export function normalizePhone(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * The comparable "core" of a UAE mobile number: digits only, with the
 * international (00971 / +971) or trunk (0) prefix removed, so
 * "050 123 4567", "+971 50 123 4567" and "0501234567" all compare equal.
 */
export function phoneCore(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('00971')) digits = digits.slice(5);
  else if (digits.startsWith('971')) digits = digits.slice(3);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

export function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}
