'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { localDateString } from '@/lib/format';

/*
 * Moving between days. Yesterday is one tap away, because a morning
 * correction to the day before is the commonest reason to leave today.
 * Tomorrow is never offered — attendance records what happened.
 */
export function AttendanceDatePicker({ date, isToday }: { date: string; isToday: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const today = localDateString();

  const shift = (days: number) => {
    const next = new Date(`${date}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + days);
    return next.toISOString().slice(0, 10);
  };
  const go = (next: string) =>
    startTransition(() =>
      router.replace(next >= today ? '/hr/attendance' : `/hr/attendance?date=${next}`),
    );

  const atToday = date >= today;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => go(shift(-1))}
        aria-label="Previous day"
        className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-card transition-colors hover:bg-muted active:bg-muted md:h-11 md:w-11"
      >
        <ChevronLeft className="size-5" />
      </button>

      <label className="relative flex min-w-0 flex-1 items-center sm:flex-none">
        <CalendarDays className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
        <span className="sr-only">Date</span>
        <input
          type="date"
          value={date}
          max={today}
          onChange={(event) => event.target.value && go(event.target.value)}
          className="h-12 w-full rounded-xl border border-input bg-card pr-3 pl-9 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-52 md:h-11 md:text-sm"
        />
      </label>

      <button
        type="button"
        onClick={() => go(shift(1))}
        disabled={atToday}
        aria-label="Next day"
        className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-card transition-colors hover:bg-muted active:bg-muted disabled:opacity-40 md:h-11 md:w-11"
      >
        <ChevronRight className="size-5" />
      </button>

      {!isToday ? (
        <button
          type="button"
          onClick={() => go(today)}
          className="inline-flex h-12 items-center rounded-xl border border-border bg-card px-4 text-sm font-medium transition-colors hover:bg-muted md:h-11"
        >
          Today
        </button>
      ) : null}

      {isPending ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
    </div>
  );
}
