import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

/*
 * Twelve months of revenue against costs, side by side, drawn with plain
 * elements like the reports' charts. Two series, so two marks and a legend:
 * revenue in the brand colour, costs (cost of sales and expenses) in a quiet
 * neutral. Each month's slot carries the exact figures on hover and focus,
 * and the table under "Show the figures" carries every number, net profit
 * included, for anyone who would rather read than compare bars.
 */

export interface TrendMonth {
  month: string;
  label: string;
  revenueFils: number;
  costsFils: number;
  netFils: number;
  revenue: string;
  costs: string;
  net: string;
}

function niceMax(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) if (step * power >= value) return step * power;
  return 10 * power;
}

const compact = new Intl.NumberFormat('en-AE', { notation: 'compact', maximumFractionDigits: 1 });

export function RevenueCostTrend({ data }: { data: TrendMonth[] }) {
  const max = niceMax(Math.max(...data.flatMap((m) => [m.revenueFils, m.costsFils]), 0) / 100);
  const ticks = [max, max / 2, 0];
  const height = (fils: number) => `${Math.max(Math.min((fils / 100 / max) * 100, 100), 0)}%`;
  const hasData = data.some((m) => m.revenueFils !== 0 || m.costsFils !== 0);

  return (
    <figure className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-primary" />
          Revenue
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-muted-foreground/35" />
          Costs and expenses
        </span>
      </div>
      {hasData ? (
        <div className="flex gap-3">
          <div className="flex h-52 flex-col justify-between text-right text-[11px] text-muted-foreground tabular-nums">
            {ticks.map((tick) => (
              <span key={tick} className="-translate-y-1/2 leading-none last:translate-y-1/2">
                {compact.format(tick)}
              </span>
            ))}
          </div>
          <div className="relative min-w-0 flex-1">
            <div aria-hidden className="absolute inset-x-0 top-0 h-52">
              {ticks.map((tick, index) => (
                <div
                  key={tick}
                  className="absolute inset-x-0 border-t border-border"
                  style={{ top: `${(index / (ticks.length - 1)) * 100}%` }}
                />
              ))}
            </div>
            <ol className="relative flex h-52 items-end">
              {data.map((month) => (
                <li
                  key={month.month}
                  tabIndex={0}
                  title={`${month.label}: revenue ${formatMoney(month.revenue)}, costs ${formatMoney(month.costs)}, profit ${formatMoney(month.net)}`}
                  aria-label={`${month.label}: revenue ${formatMoney(month.revenue)}, costs ${formatMoney(month.costs)}, profit ${formatMoney(month.net)}`}
                  className="group flex h-full min-w-0 flex-1 items-end justify-center gap-[2px] rounded-sm px-[2px] outline-none hover:bg-muted/50 focus-visible:bg-muted/50 sm:gap-1 sm:px-1"
                >
                  <span
                    className="w-full max-w-4 rounded-t-[3px] bg-primary transition-opacity group-hover:opacity-90"
                    style={{ height: height(month.revenueFils) }}
                  />
                  <span
                    className="w-full max-w-4 rounded-t-[3px] bg-muted-foreground/35"
                    style={{ height: height(month.costsFils) }}
                  />
                </li>
              ))}
            </ol>
            <ol aria-hidden className="mt-2 flex text-[10px] text-muted-foreground sm:text-[11px]">
              {data.map((month, index) => (
                <li key={month.month} className="min-w-0 flex-1 truncate text-center">
                  {/* On a narrow screen every other month, so the labels never overlap. */}
                  <span className={cn(index % 2 === 1 && 'max-sm:invisible')}>
                    {month.label.split(' ')[0]}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Nothing booked in these twelve months yet.
        </p>
      )}
      <details className="group/details text-sm">
        <summary className="cursor-pointer text-xs font-medium text-primary select-none">
          Show the figures
        </summary>
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[28rem] text-sm">
            <thead className="bg-muted/50 text-left text-xs font-semibold text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Month</th>
                <th className="px-3 py-2 text-right">Revenue</th>
                <th className="px-3 py-2 text-right">Costs</th>
                <th className="px-3 py-2 text-right">Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((month) => (
                <tr key={month.month}>
                  <td className="px-3 py-2">{month.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMoney(month.revenue)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(month.costs)}</td>
                  <td
                    className={cn(
                      'px-3 py-2 text-right font-medium tabular-nums',
                      month.netFils < 0 && 'text-danger',
                    )}
                  >
                    {formatMoney(month.net)}
                  </td>
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
 * Twelve months of a count — job cards opened, say — with a second count
 * beside it (vehicles delivered). Same drawing rules as the money trend.
 */
export function MonthlyCounts({
  data,
  first,
  second,
}: {
  data: { month: string; label: string; first: number; second: number }[];
  first: string;
  second: string;
}) {
  const max = niceMax(Math.max(...data.flatMap((m) => [m.first, m.second]), 0));
  const ticks = [max, max / 2, 0];
  const height = (value: number) => `${Math.max(Math.min((value / max) * 100, 100), 0)}%`;
  const hasData = data.some((m) => m.first > 0 || m.second > 0);
  const describe = (m: { label: string; first: number; second: number }) =>
    `${m.label}: ${m.first} ${first.toLowerCase()}, ${m.second} ${second.toLowerCase()}`;
  return (
    <figure className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-primary" />
          {first}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-muted-foreground/35" />
          {second}
        </span>
      </div>
      {hasData ? (
        <div className="flex gap-3">
          <div className="flex h-44 flex-col justify-between text-right text-[11px] text-muted-foreground tabular-nums">
            {ticks.map((tick) => (
              <span key={tick} className="-translate-y-1/2 leading-none last:translate-y-1/2">
                {Number.isInteger(tick) ? tick : tick.toFixed(1)}
              </span>
            ))}
          </div>
          <div className="relative min-w-0 flex-1">
            <div aria-hidden className="absolute inset-x-0 top-0 h-44">
              {ticks.map((tick, index) => (
                <div
                  key={tick}
                  className="absolute inset-x-0 border-t border-border"
                  style={{ top: `${(index / (ticks.length - 1)) * 100}%` }}
                />
              ))}
            </div>
            <ol className="relative flex h-44 items-end">
              {data.map((month) => (
                <li
                  key={month.month}
                  tabIndex={0}
                  title={describe(month)}
                  aria-label={describe(month)}
                  className="flex h-full min-w-0 flex-1 items-end justify-center gap-[2px] rounded-sm px-[2px] outline-none hover:bg-muted/50 focus-visible:bg-muted/50 sm:gap-1 sm:px-1"
                >
                  <span
                    className="w-full max-w-4 rounded-t-[3px] bg-primary"
                    style={{ height: height(month.first) }}
                  />
                  <span
                    className="w-full max-w-4 rounded-t-[3px] bg-muted-foreground/35"
                    style={{ height: height(month.second) }}
                  />
                </li>
              ))}
            </ol>
            <ol aria-hidden className="mt-2 flex text-[10px] text-muted-foreground sm:text-[11px]">
              {data.map((month, index) => (
                <li key={month.month} className="min-w-0 flex-1 truncate text-center">
                  <span className={cn(index % 2 === 1 && 'max-sm:invisible')}>
                    {month.label.split(' ')[0]}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Nothing in these twelve months yet.
        </p>
      )}
    </figure>
  );
}
