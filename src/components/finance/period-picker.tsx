'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CalendarRange, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/forms/fields';
import { cn } from '@/lib/utils';

export const PERIOD_PRESETS = {
  today: 'Today',
  week: 'This week',
  month: 'This month',
  'last-month': 'Last month',
  quarter: 'This quarter',
  'last-quarter': 'Last quarter',
  year: 'This year',
} as const;

export type PeriodPreset = keyof typeof PERIOD_PRESETS;

const DEFAULT_PRESETS: PeriodPreset[] = ['today', 'week', 'month'];

/**
 * Which days the figures cover. The dates are the workshop's own (Dubai), and
 * the choice lives in the URL so a period can be shared or reloaded.
 */
export function FinancePeriodPicker({
  period,
  basePath = '/finance',
  presets = DEFAULT_PRESETS,
}: {
  period: { key: string; label: string; from: string; to: string };
  /** The screen the figures are on. Its other URL parameters (a tab, say) are kept. */
  basePath?: string;
  presets?: PeriodPreset[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [custom, setCustom] = useState(period.key === 'custom');
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);

  function go(changes: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of ['period', 'from', 'to']) params.delete(key);
    for (const [key, value] of Object.entries(changes)) params.set(key, value);
    startTransition(() => router.push(`${basePath}?${params}`));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Period" className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-current={period.key === preset ? 'page' : undefined}
              onClick={() => {
                setCustom(false);
                go({ period: preset });
              }}
              className={cn(
                'h-9 rounded-md px-3 text-sm transition-colors',
                period.key === preset
                  ? 'bg-card font-medium shadow-card'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {PERIOD_PRESETS[preset]}
            </button>
          ))}
        </nav>
        <Button
          type="button"
          variant={period.key === 'custom' ? 'secondary' : 'outline'}
          className="h-11 sm:h-9"
          onClick={() => setCustom((open) => !open)}
          aria-expanded={custom}
        >
          <CalendarRange />
          Custom range
        </Button>
        {isPending ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
      </div>

      {custom ? (
        <form
          className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-card sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            go({ period: 'custom', from, to });
          }}
        >
          <TextField
            label="From"
            name="from"
            type="date"
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
            className="[&_input]:h-11 [&_input]:text-base sm:w-48 md:[&_input]:text-sm"
          />
          <TextField
            label="To"
            name="to"
            type="date"
            value={to}
            min={from}
            onChange={(event) => setTo(event.target.value)}
            className="[&_input]:h-11 [&_input]:text-base sm:w-48 md:[&_input]:text-sm"
          />
          <Button type="submit" size="lg" className="h-11" disabled={isPending}>
            Apply
          </Button>
        </form>
      ) : null}
    </div>
  );
}
