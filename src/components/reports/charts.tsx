import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

/*
 * The two chart forms the reports need, drawn with plain elements — no
 * charting library for twelve columns and a ranked list.
 *
 * One series each, so one colour (the brand primary) and no legend: the
 * section title says what is plotted. Columns are capped at 24px with a 4px
 * rounded top and a square foot on the baseline; each column's whole slot is
 * its hover and focus target, carrying the exact value. The table beneath
 * carries every figure for anyone who can't, or would rather not, read bars.
 */

/** A round axis top: 1, 2 or 5 × a power of ten, at or above the largest value. */
function niceMax(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (step * power >= value) return step * power;
  }
  return 10 * power;
}

const compact = new Intl.NumberFormat('en-AE', { notation: 'compact', maximumFractionDigits: 1 });

export function MonthlyColumns({
  data,
  caption,
  noun = 'invoice',
  valueHeading = 'Sales',
}: {
  data: { month: string; label: string; valueFils: number; value: string; count: number }[];
  caption: string;
  /** What each month counts, singular: "invoice", "purchase". */
  noun?: string;
  /** The amount column's heading in the table. */
  valueHeading?: string;
}) {
  const max = niceMax(Math.max(...data.map((row) => row.valueFils)) / 100);
  const ticks = [max, max / 2, 0];
  const peak = data.reduce((best, row) => (row.valueFils > best.valueFils ? row : best), data[0]);

  return (
    <figure className="flex flex-col gap-4">
      <div className="flex gap-3">
        {/* Y axis: three round ticks, in muted ink. */}
        <div className="flex h-48 flex-col justify-between pb-0 text-right text-[11px] text-muted-foreground tabular-nums">
          {ticks.map((tick) => (
            <span key={tick} className="-translate-y-1/2 leading-none last:translate-y-1/2">
              {compact.format(tick)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          {/* Hairline gridlines at each tick. */}
          <div aria-hidden className="absolute inset-x-0 top-0 h-48">
            {ticks.map((tick, index) => (
              <div
                key={tick}
                className="absolute inset-x-0 border-t border-border"
                style={{ top: `${(index / (ticks.length - 1)) * 100}%` }}
              />
            ))}
          </div>
          <ol className="relative flex h-48 items-end" aria-hidden>
            {data.map((row) => {
              const height = (row.valueFils / 100 / max) * 100;
              const isPeak = row === peak && row.valueFils > 0;
              return (
                <li
                  key={row.month}
                  tabIndex={0}
                  className="group relative flex h-full flex-1 items-end justify-center outline-none"
                >
                  <span
                    className="w-full max-w-6 rounded-t-[4px] bg-primary transition-opacity group-hover:opacity-80 group-focus-visible:ring-2 group-focus-visible:ring-ring"
                    style={{ height: `${Math.max(height, row.valueFils > 0 ? 1 : 0)}%` }}
                  />
                  {isPeak ? (
                    <span className="pointer-events-none absolute -top-5 text-[11px] font-medium whitespace-nowrap text-foreground tabular-nums group-hover:hidden">
                      {compact.format(row.valueFils / 100)}
                    </span>
                  ) : null}
                  <span className="pointer-events-none absolute bottom-full z-10 mb-2 hidden -translate-y-1 flex-col rounded-lg border border-border bg-card px-3 py-2 text-xs whitespace-nowrap shadow-card group-hover:flex group-focus-visible:flex">
                    <span className="font-medium">{row.label}</span>
                    <span className="tabular-nums">{formatMoney(row.value)}</span>
                    <span className="text-muted-foreground">
                      {row.count} {noun}
                      {row.count === 1 ? '' : 's'}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
          <ol aria-hidden className="mt-2 flex text-[11px] text-muted-foreground">
            {data.map((row, index) => (
              <li key={row.month} className="flex-1 text-center">
                {/* Every other month on a phone; all twelve from `sm`. */}
                <span className={cn(index % 2 === 1 && 'hidden sm:inline')}>
                  {row.label.split(' ')[0]}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          Show as a table
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[320px] text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead className="text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
              <tr>
                <th className="py-2">Month</th>
                <th className="py-2 text-right capitalize">{noun}s</th>
                <th className="py-2 text-right">{valueHeading}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((row) => (
                <tr key={row.month}>
                  <td className="py-2">{row.label}</td>
                  <td className="py-2 text-right tabular-nums">{row.count}</td>
                  <td className="py-2 text-right tabular-nums">{formatMoney(row.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/**
 * A ranked list with a thin bar under each row, scaled to the largest. The
 * figure is always written out, so the bar only helps the eye compare.
 */
export function RankedBars({
  rows,
}: {
  rows: { key: string; label: string; detail?: string | null; value: string; weight: number }[];
}) {
  const max = Math.max(...rows.map((row) => row.weight), 1);
  return (
    <ol className="divide-y divide-border">
      {rows.map((row, index) => (
        <li key={row.key} className="flex flex-col gap-2 px-4 py-3 sm:px-6">
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="w-4 shrink-0 text-xs text-muted-foreground tabular-nums">
                {index + 1}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm">{row.label}</span>
                {row.detail ? (
                  <span className="truncate text-xs text-muted-foreground">{row.detail}</span>
                ) : null}
              </span>
            </span>
            <span className="shrink-0 text-sm font-medium tabular-nums">{row.value}</span>
          </div>
          <div className="ml-6 h-1.5 rounded-full bg-muted" aria-hidden>
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.max((row.weight / max) * 100, 2)}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}
