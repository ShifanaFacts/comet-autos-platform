'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CalendarRange, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/forms/fields';
import { cn } from '@/lib/utils';

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
] as const;

/**
 * Which days the figures cover. The dates are the workshop's own (Dubai), and
 * the choice lives in the URL so a period can be shared or reloaded.
 */
export function FinancePeriodPicker({
  period,
}: {
  period: { key: string; label: string; from: string; to: string };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [custom, setCustom] = useState(period.key === 'custom');
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);

  function go(search: string) {
    startTransition(() => router.push(`/finance?${search}`));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Period" className="flex gap-1 rounded-lg bg-muted p-1">
          {PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              aria-current={period.key === preset.key ? 'page' : undefined}
              onClick={() => {
                setCustom(false);
                go(`period=${preset.key}`);
              }}
              className={cn(
                'h-9 rounded-md px-3 text-sm transition-colors',
                period.key === preset.key
                  ? 'bg-card font-medium shadow-card'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {preset.label}
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
            go(`period=custom&from=${from}&to=${to}`);
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
