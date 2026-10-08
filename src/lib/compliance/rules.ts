/*
 * The UAE dates a small company lives by, as pure rules — no database.
 * Every date is a calendar day, "YYYY-MM-DD".
 *
 *   VAT          a return for every tax period on the FTA certificate (1 or 3
 *                months, back to back); return and payment due 28 days after
 *                the period ends.
 *   Corporate    the tax period is the financial year. 0% on taxable income
 *   tax          up to AED 375,000, 9% above it; return and payment due nine
 *                months after the year ends. Small Business Relief: revenue
 *                of AED 3 million or less, for tax periods ending on or before
 *                31 December 2026.
 *
 * lib/finance/vat.ts re-exports VAT_DUE_DAYS for the return itself.
 */

/** A VAT return is filed, and the VAT paid, by the 28th day after its period ends. */
export const VAT_DUE_DAYS = 28;

const DAY_MS = 86_400_000;
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
const asDay = (date: Date) => date.toISOString().slice(0, 10);

export function addDays(day: string, days: number): string {
  return asDay(new Date(asDate(day).getTime() + days * DAY_MS));
}

/** Days from `from` to `to`: 0 the same day, negative once `to` has passed. */
export function daysBetween(from: string, to: string): number {
  return Math.round((asDate(to).getTime() - asDate(from).getTime()) / DAY_MS);
}

/** The last day of a month; months outside 1–12 roll over the year. */
export function lastDayOfMonth(year: number, month: number): string {
  return asDay(new Date(Date.UTC(year, month, 0)));
}

/**
 * The day before the same day `months` later: a period of `months` that
 * starts on `start`. From the 1st it ends on a month end (1 Oct + 3 → 31 Dec).
 */
export function periodEnd(start: string, months: number): string {
  const [year, month, day] = start.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1 + months, day));
  // 31 Jan + 1 month has no 31 Feb: end on the last day of the shorter month.
  if (next.getUTCDate() !== day) return lastDayOfMonth(year, month + months);
  return addDays(asDay(next), -1);
}

// ── VAT ──────────────────────────────────────────────────────────────────

export interface VatSchedule {
  firstStart: string;
  firstEnd: string;
  /** 3 quarterly, 1 monthly. */
  months: number;
}

export interface VatPeriod {
  from: string;
  to: string;
  /** Return filed and VAT paid by this day. */
  due: string;
}

export const vatDue = (to: string) => addDays(to, VAT_DUE_DAYS);

/**
 * The VAT periods from the first one on the certificate up to the one after
 * the period `through` falls in — every return there has been, and the next.
 */
export function vatPeriods(schedule: VatSchedule, through: string, cap = 200): VatPeriod[] {
  const periods: VatPeriod[] = [];
  let from = schedule.firstStart;
  let to = schedule.firstEnd;
  while (periods.length < cap) {
    periods.push({ from, to, due: vatDue(to) });
    if (from > through) break;
    from = addDays(to, 1);
    to = periodEnd(from, schedule.months);
  }
  return periods;
}

// ── Financial year ───────────────────────────────────────────────────────

export interface FinancialYearRule {
  /** 1–12: the year ends on the last day of this month. */
  endMonth: number;
  /** The end of the first year, when it is not twelve months. */
  firstYearEnd?: string | null;
  /** The first day the books cover, for the first year's start. */
  booksStart?: string | null;
}

export interface FinancialYear {
  /** The first day — the books' first day for the first year, when known. */
  start: string | null;
  end: string;
  first: boolean;
}

/** The financial year a day falls in. */
export function financialYearOf(day: string, rule: FinancialYearRule): FinancialYear {
  const first = rule.firstYearEnd ?? null;
  if (first && day <= first) {
    return { start: rule.booksStart ?? null, end: first, first: true };
  }
  const [year, month] = day.split('-').map(Number);
  let end = lastDayOfMonth(month <= rule.endMonth ? year : year + 1, rule.endMonth);
  if (end < day) end = lastDayOfMonth(year + 1, rule.endMonth);
  let start = addDays(lastDayOfMonth(Number(end.slice(0, 4)) - 1, rule.endMonth), 1);
  // The year straight after a long or short first year starts the day after it.
  if (first && start <= first) start = addDays(first, 1);
  const isFirst = !first && Boolean(rule.booksStart && rule.booksStart >= start);
  return {
    start: isFirst && rule.booksStart ? rule.booksStart : start,
    end,
    first: isFirst,
  };
}

/** The financial year that ended most recently on or before `day`, if any has. */
export function lastEndedYear(day: string, rule: FinancialYearRule): FinancialYear | null {
  const current = financialYearOf(day, rule);
  if (current.end <= day) return current;
  if (!current.start) return null;
  const before = addDays(current.start, -1);
  if (rule.booksStart && before < rule.booksStart) return null;
  return financialYearOf(before, rule);
}

// ── Corporate tax ────────────────────────────────────────────────────────

/** Taxable income up to this is taxed at 0%. In fils. */
export const CT_THRESHOLD_FILS = 375_000_00;
/** Revenue at or under this may elect Small Business Relief. In fils. */
export const SBR_REVENUE_LIMIT_FILS = 3_000_000_00;
/** Small Business Relief applies to tax periods ending on or before this day. */
export const SBR_LAST_PERIOD_END = '2026-12-31';
export const CT_RATE_PERCENT = 9;

/** Corporate tax return and payment: the last day of the ninth month after the year ends. */
export function corporateTaxDue(yearEnd: string): string {
  const [year, month] = yearEnd.split('-').map(Number);
  return lastDayOfMonth(year, month + 9);
}

/** 9% of profit above AED 375,000, in fils — before any adjustments the return makes. */
export function corporateTaxEstimateFils(profitFils: number): number {
  const above = profitFils - CT_THRESHOLD_FILS;
  return above > 0 ? Math.round((above * CT_RATE_PERCENT) / 100) : 0;
}

/** Whether a year could elect Small Business Relief (and so owe no corporate tax). */
export function smallBusinessReliefPossible(yearEnd: string, revenueFils: number): boolean {
  return yearEnd <= SBR_LAST_PERIOD_END && revenueFils <= SBR_REVENUE_LIMIT_FILS;
}
