'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, History } from 'lucide-react';
import { CONTROL } from '@/components/forms/control';
import { addDays } from '@/lib/team/client';
import { cn } from '@/lib/utils';

/**
 * Looking back at a day: the arrows step a day at a time, the box jumps to
 * any date, "Back to my list" returns to today's list with everything
 * pending above it.
 */
export function DayNav({ basePath, date, today }: { basePath: string; date: string | null; today: string }) {
  const router = useRouter();
  const current = date ?? today;
  const go = (key: string) => router.push(key === today ? basePath : `${basePath}?date=${key}`);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <History className="size-4" />
        History
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => go(addDays(current, -1))}
          aria-label="Previous day"
          className="flex size-11 items-center justify-center rounded-lg border border-border bg-card hover:bg-muted"
        >
          <ChevronLeft className="size-4" />
        </button>
        <input
          type="date"
          value={current}
          onChange={(event) => event.target.value && go(event.target.value)}
          aria-label="Choose a day"
          className={cn(CONTROL, 'h-11 w-44')}
        />
        <button
          type="button"
          onClick={() => go(addDays(current, 1))}
          aria-label="Next day"
          className="flex size-11 items-center justify-center rounded-lg border border-border bg-card hover:bg-muted"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      {date && date !== today ? (
        <button
          type="button"
          onClick={() => go(today)}
          className="h-11 rounded-lg px-3 text-sm font-medium text-primary hover:bg-primary/5"
        >
          Back to my list
        </button>
      ) : null}
    </div>
  );
}
