'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlarmClock, CheckCircle2, Clock, Loader2, LogIn, LogOut, MapPin, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CONTROL } from '@/components/forms/control';
import { FormError } from '@/components/forms/fields';
import { formatTime } from '@/lib/format';
import { formatDistance } from '@/lib/team/geo';
import { newRequestKey } from '@/lib/team/client';
import { reportLeftAtAction, selfClockAction } from '@/app/(app)/my-work/actions';
import { cn } from '@/lib/utils';

/*
 * Checking in and out from your own phone, at the workshop.
 *
 * One big button. Tapping it asks the phone where it is (precisely, fresh,
 * not a remembered position) and sends that; the server decides whether it
 * is close enough. If someone is no longer at the workshop when they try to
 * check out — they forgot, and went home — they are offered the other way:
 * say what time they left. That, and a day closed automatically, is flagged
 * for the manager to confirm.
 */

export interface CheckInDay {
  date: string;
  next: 'IN' | 'OUT' | 'DONE';
  record: { id: string; clockInAt: Date | null; clockOutAt: Date | null; clockOutMethod: string | null; needsReview: boolean } | null;
  workedLabel: string;
  fenceSet: boolean;
  radiusM: number | null;
  shiftEndTime: string | null;
  pastShiftEnd: boolean;
  openEarlier: { id: string; date: string; clockInAt: Date; willCloseAt: Date } | null;
  awaitingReview: number;
}

type Locating = 'idle' | 'locating' | 'sending';

function locate(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('unsupported'));
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 25_000,
      maximumAge: 0,
    });
  });
}

const LOCATION_ERRORS: Record<number, string> = {
  1: 'Location is blocked for this site. Allow location in the browser’s settings (and turn on precise location), then try again.',
  2: 'The phone couldn’t find where it is. Turn on location/GPS and try again.',
  3: 'Finding your location took too long. Step near a window or outside and try again.',
};

const dayName = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString('en-AE', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short' });

export function CheckInCard({ day }: { day: CheckInDay }) {
  const router = useRouter();
  const [state, setState] = useState<Locating>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const [offerReport, setOfferReport] = useState(false);
  const [reporting, setReporting] = useState<{ id: string; date: string; clockInAt: Date } | null>(null);

  async function clock(direction: 'IN' | 'OUT') {
    setProblem(null);
    setOfferReport(false);
    setState('locating');
    let position: GeolocationPosition;
    try {
      position = await locate();
    } catch (error) {
      setState('idle');
      const code = (error as GeolocationPositionError).code;
      setProblem(LOCATION_ERRORS[code] ?? 'This browser can’t share its location. Use Chrome, or Safari on an iPhone.');
      return;
    }
    setState('sending');
    const result = await selfClockAction(
      direction,
      {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      },
      day.date,
    );
    setState('idle');
    if (!result.ok) {
      setProblem(result.error ?? 'That could not be recorded.');
      // Not at the workshop any more when checking out: they have probably left.
      if (direction === 'OUT' && /from the workshop/.test(result.error ?? '')) setOfferReport(true);
      return;
    }
    toast.success(direction === 'IN' ? 'Checked in — have a good day' : 'Checked out — see you tomorrow');
    if (result.data?.closed.length) {
      toast.warning(
        `You didn’t check out on ${result.data.closed.map(dayName).join(', ')}. It was closed at the shift end and sent to your manager to check.`,
      );
    }
    router.refresh();
  }

  const busy = state !== 'idle';
  const record = day.record;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border/70 bg-card p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-[17px] font-semibold">Attendance</h2>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {record?.clockInAt ? (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-4" />
                In {formatTime(record.clockInAt)}
                {record.clockOutAt ? ` · out ${formatTime(record.clockOutAt)}` : ''}
                {day.workedLabel !== '—' ? ` · ${day.workedLabel}` : ''}
              </span>
            ) : (
              <span>Not checked in yet today.</span>
            )}
            {day.fenceSet && day.radiusM ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-4" />
                within {formatDistance(day.radiusM)} of the workshop
              </span>
            ) : null}
          </p>
        </div>
        {day.next === 'DONE' ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
            <CheckCircle2 className="size-5" />
            Day done
          </span>
        ) : null}
      </div>

      {!day.fenceSet ? (
        <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-sm text-warning">
          The workshop’s location hasn’t been set yet, so checking in from a phone is off. The owner sets it
          once in Settings → Branch → Location lock.
        </p>
      ) : day.next !== 'DONE' ? (
        <button
          type="button"
          onClick={() => clock(day.next as 'IN' | 'OUT')}
          disabled={busy}
          className={cn(
            'flex h-16 w-full items-center justify-center gap-3 rounded-xl text-lg font-semibold transition-colors disabled:opacity-70',
            day.next === 'IN'
              ? 'bg-primary text-primary-foreground hover:bg-primary-hover'
              : 'border-2 border-foreground/80 bg-card hover:bg-muted',
          )}
        >
          {busy ? (
            <Loader2 className="size-6 animate-spin" />
          ) : day.next === 'IN' ? (
            <LogIn className="size-6" />
          ) : (
            <LogOut className="size-6" />
          )}
          {state === 'locating'
            ? 'Finding your location…'
            : state === 'sending'
              ? 'Saving…'
              : day.next === 'IN'
                ? 'Check in'
                : 'Check out'}
        </button>
      ) : null}

      {day.pastShiftEnd ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-sm text-warning">
          <AlarmClock className="mt-0.5 size-4 shrink-0" />
          The day ended at {day.shiftEndTime}. Check out before you leave — if you forget, the day is closed
          at {day.shiftEndTime} and your manager is asked to check it.
        </p>
      ) : null}

      {problem ? (
        <div role="alert" className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          <span className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {problem}
          </span>
          {offerReport && record?.clockInAt ? (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-fit"
              onClick={() => setReporting({ id: record.id, date: day.date, clockInAt: record.clockInAt! })}
            >
              I’ve already left — tell the time
            </Button>
          ) : null}
        </div>
      ) : null}

      {day.openEarlier ? (
        <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-3 text-sm">
          <p className="text-warning">
            You didn’t check out on {dayName(day.openEarlier.date)} (in at {formatTime(day.openEarlier.clockInAt)}).
            If you don’t say when you left, it closes at {formatTime(day.openEarlier.willCloseAt)} when you next
            check in.
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-fit"
            onClick={() => setReporting(day.openEarlier)}
          >
            Tell the time I left
          </Button>
        </div>
      ) : null}

      {day.awaitingReview > 0 ? (
        <p className="text-xs text-muted-foreground">
          {day.awaitingReview === 1 ? 'One day is' : `${day.awaitingReview} days are`} waiting for your manager
          to confirm the check-out time.
        </p>
      ) : null}

      {reporting ? <ReportDialog day={reporting} onClose={() => setReporting(null)} /> : null}
    </section>
  );
}

function ReportDialog({
  day,
  onClose,
}: {
  day: { id: string; date: string; clockInAt: Date };
  onClose: () => void;
}) {
  const router = useRouter();
  const [leftAt, setLeftAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [requestKey] = useState(newRequestKey);

  function save() {
    const form = new FormData();
    form.set('leftAt', leftAt);
    form.set('requestKey', requestKey);
    startTransition(async () => {
      const result = await reportLeftAtAction(day.id, { ok: false }, form);
      if (!result.ok) {
        setError(result.error ?? 'That could not be saved.');
        return;
      }
      toast.success('Saved — your manager will confirm it');
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>When did you leave?</DialogTitle>
          <DialogDescription>
            {dayName(day.date)} — you checked in at {formatTime(day.clockInAt)}. Your manager will see that you
            reported this yourself.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <input
            type="time"
            value={leftAt}
            onChange={(event) => setLeftAt(event.target.value)}
            aria-label="Time you left"
            className={cn(CONTROL, 'h-12 w-40 text-base')}
          />
          <FormError message={error ?? undefined} />
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button type="button" onClick={save} disabled={pending || !leftAt} className="h-12 sm:h-11">
              {pending ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="ghost" className="h-12 sm:h-11" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
