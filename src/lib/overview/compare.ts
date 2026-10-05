import type { ResolvedPeriod } from '@/lib/finance/dashboard';

/*
 * Growth on the overviews: each period against the one before it, like for
 * like. "This month" (the 1st to today) is compared with the same days last
 * month, "This year" with the same days last year — never a whole month with
 * a few days of one.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function shiftDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The same day `months` earlier, kept inside the shorter month (31 March → 28/29 February). */
function shiftMonths(date: string, months: number) {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 - months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

/** The period to compare with, as input for the same loaders, and how to say it. */
export function comparisonOf(period: ResolvedPeriod): {
  input: { period: 'custom'; from: string; to: string };
  label: string;
} {
  const shift = (months: number) => ({
    period: 'custom' as const,
    from: shiftMonths(period.from, months),
    to: shiftMonths(period.to, months),
  });
  switch (period.key) {
    case 'today':
      return {
        input: { period: 'custom', from: shiftDays(period.from, -1), to: shiftDays(period.to, -1) },
        label: 'vs yesterday',
      };
    case 'week':
      return {
        input: { period: 'custom', from: shiftDays(period.from, -7), to: shiftDays(period.to, -7) },
        label: 'vs the same days last week',
      };
    case 'month':
      return { input: shift(1), label: 'vs the same days last month' };
    case 'last-month':
      return { input: shift(1), label: 'vs the month before' };
    case 'quarter':
      return { input: shift(3), label: 'vs the same days last quarter' };
    case 'last-quarter':
      return { input: shift(3), label: 'vs the quarter before' };
    case 'year':
      return { input: shift(12), label: 'vs the same days last year' };
    default: {
      const days = Math.round((Date.parse(period.to) - Date.parse(period.from)) / DAY_MS) + 1;
      return {
        input: {
          period: 'custom',
          from: shiftDays(period.from, -days),
          to: shiftDays(period.from, -1),
        },
        label: `vs the ${days} days before`,
      };
    }
  }
}

/**
 * Change from the earlier figure, in percent to one decimal; null when there
 * is nothing to compare with (the earlier figure was zero).
 */
export function growth(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}
