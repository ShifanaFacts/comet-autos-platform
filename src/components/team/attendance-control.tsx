'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlarmClock, CheckCircle2, Loader2, LogIn, LogOut, TriangleAlert } from 'lucide-react';
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
import { formatTime } from '@/lib/format';
import { reportLeftAtAction, selfClockAction } from '@/app/(app)/my-work/actions';
import { cn } from '@/lib/utils';
import { announce, cancelAnnouncement } from '@/lib/notifications/sound';

/*
 * Attendance, wherever the employee is in the app.
 *
 *  - A pill in the top bar says where they stand: "Check in", "In · 8:05",
 *    "Day done". Tapping it opens the matching window.
 *  - Opening the app without having checked in brings up the check-in
 *    window (once per visit — "Later" puts it away). If yesterday was left
 *    open, it first asks what time they left, then checks them in.
 *  - When the working day ends (the branch's shift end, e.g. 9 pm) and they
 *    are still checked in, it asks them to check out. "Still working" asks
 *    again an hour later. Time after the shift end is overtime — shown to
 *    managers on the attendance screens, never here.
 */

export interface AttendanceStatus {
  date: string;
  firstName: string;
  next: 'IN' | 'OUT' | 'DONE';
  recordId: string | null;
  clockInAt: Date | null;
  /** Marked absent, on leave or a holiday for today: no nagging. */
  away: boolean;
  fenceSet: boolean;
  shiftEndTime: string | null;
  openEarlier: { id: string; date: string; clockInAt: Date } | null;
}

const LATER_KEY = 'garage:checkin-later';
const SNOOZE_KEY = 'garage:checkout-snooze';
const SNOOZE_MS = 60 * 60 * 1000;

const LOCATION_ERRORS: Record<number, string> = {
  1: 'Location is blocked for this site. Allow location in the browser’s settings (and turn on precise location), then try again.',
  2: 'The phone couldn’t find where it is. Turn on location/GPS and try again.',
  3: 'Finding your location took too long. Step near a window or outside and try again.',
};

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

const dayName = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString('en-AE', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });

const read = (key: string) => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    sessionStorage.setItem(key, value);
  } catch {}
};

/** Checking in or out from where the phone is, with the reason in plain words when it can't. */
export function useSelfClock(date: string) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'locating' | 'sending'>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const [away, setAway] = useState(false);

  const clock = useCallback(
    async (direction: 'IN' | 'OUT', previousLeftAt?: string) => {
      setProblem(null);
      setAway(false);
      setState('locating');
      let position: GeolocationPosition;
      try {
        position = await locate();
      } catch (error) {
        setState('idle');
        const code = (error as GeolocationPositionError).code;
        setProblem(LOCATION_ERRORS[code] ?? 'This browser can’t share its location. Use Chrome, or Safari on an iPhone.');
        return false;
      }
      setState('sending');
      const result = await selfClockAction(
        direction,
        {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        },
        date,
        previousLeftAt,
      );
      setState('idle');
      if (!result.ok) {
        setProblem(result.error ?? 'That could not be recorded.');
        // No longer at the workshop when checking out: they have probably left.
        if (direction === 'OUT' && /from the workshop/.test(result.error ?? '')) setAway(true);
        return false;
      }
      toast.success(direction === 'IN' ? 'Checked in — have a good day' : 'Checked out — see you tomorrow');
      router.refresh();
      return true;
    },
    [date, router],
  );

  return { state, busy: state !== 'idle', problem, away, clock };
}

/** The top-bar pill, and the windows that come up by themselves. */
export function AttendanceControl({ status }: { status: AttendanceStatus }) {
  const [open, setOpen] = useState<'in' | 'out' | null>(null);

  useEffect(() => {
    if (!status.fenceSet || status.away) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    if (status.next === 'IN') {
      // Once per visit and day: "Later" means later, not every page.
      if (read(LATER_KEY) !== status.date) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- opened after hydration, from browser state
        setOpen('in');
        announce('CHECK_IN_REMINDER');
      }
    } else if (status.next === 'OUT' && status.shiftEndTime) {
      const shiftEnd = new Date(`${status.date}T${status.shiftEndTime}:00+04:00`).getTime();
      const remind = () => {
        const snoozedUntil = Number(read(SNOOZE_KEY) ?? 0);
        const at = Math.max(shiftEnd, snoozedUntil);
        const wait = at - Date.now();
        if (wait <= 0) {
          setOpen('out');
          announce('CHECK_OUT_REMINDER');
        }
        else if (wait < 24 * 60 * 60 * 1000) timer = setTimeout(remind, wait);
      };
      remind();
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [status.date, status.next, status.shiftEndTime, status.fenceSet, status.away]);

  const pill =
    status.next === 'IN'
      ? {
          icon: LogIn,
          text: 'Check in',
          className: 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/15',
        }
      : status.next === 'OUT'
        ? {
            icon: CheckCircle2,
            text: `In · ${status.clockInAt ? formatTime(status.clockInAt) : ''}`,
            className: 'border-success/40 bg-success/10 text-success hover:bg-success/15',
          }
        : {
            icon: CheckCircle2,
            text: 'Day done',
            className: 'border-border bg-card text-muted-foreground hover:bg-muted',
          };
  const Icon = pill.icon;

  return (
    <>
      <button
        type="button"
        onClick={() => status.next !== 'DONE' && setOpen(status.next === 'IN' ? 'in' : 'out')}
        className={cn(
          'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors',
          pill.className,
          status.next === 'DONE' && 'cursor-default',
        )}
        aria-label={status.next === 'IN' ? 'Check in' : status.next === 'OUT' ? 'Checked in — check out' : 'Day done'}
      >
        <Icon className="size-4" />
        <span className={cn(status.next === 'OUT' && 'hidden sm:inline')}>{pill.text}</span>
      </button>

      {open === 'in' ? (
        <CheckInDialog
          status={status}
          onClose={() => {
            cancelAnnouncement('CHECK_IN_REMINDER');
            write(LATER_KEY, status.date);
            setOpen(null);
          }}
        />
      ) : null}
      {open === 'out' ? (
        <CheckOutDialog
          status={status}
          onClose={(snooze) => {
            cancelAnnouncement('CHECK_OUT_REMINDER');
            if (snooze) write(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
            setOpen(null);
          }}
        />
      ) : null}
    </>
  );
}

/** Checking in — first asking when they left, if the last day was left open. */
export function CheckInDialog({ status, onClose }: { status: AttendanceStatus; onClose: () => void }) {
  const { busy, state, problem, clock } = useSelfClock(status.date);
  const [leftAt, setLeftAt] = useState('');
  const needsLeftAt = status.openEarlier !== null;

  async function checkIn() {
    if (needsLeftAt && !leftAt) return;
    // Answering the popup: its reminder, if still waiting for a first tap, would only be late.
    cancelAnnouncement('CHECK_IN_REMINDER');
    if (await clock('IN', needsLeftAt ? leftAt : undefined)) onClose();
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Good {greeting()}, {status.firstName}</DialogTitle>
          <DialogDescription>
            {status.fenceSet
              ? 'You haven’t checked in today. Check in from the workshop — your phone’s location is used.'
              : 'Checking in from a phone is off until the workshop’s location is set in Settings.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {needsLeftAt && status.openEarlier ? (
            <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
              <p className="text-sm text-warning">
                You didn’t check out on {dayName(status.openEarlier.date)} (in at{' '}
                {formatTime(status.openEarlier.clockInAt)}). What time did you leave?
              </p>
              <input
                type="time"
                value={leftAt}
                onChange={(event) => setLeftAt(event.target.value)}
                aria-label={`Time you left on ${dayName(status.openEarlier.date)}`}
                className={cn(CONTROL, 'h-12 w-40 text-base')}
              />
            </div>
          ) : null}
          {problem ? (
            <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {problem}
            </p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            {status.fenceSet ? (
              <Button
                className="h-12 text-base sm:h-11 sm:text-sm"
                onClick={checkIn}
                disabled={busy || (needsLeftAt && !leftAt)}
              >
                {busy ? <Loader2 className="animate-spin" /> : <LogIn />}
                {state === 'locating' ? 'Finding your location…' : state === 'sending' ? 'Saving…' : 'Check in'}
              </Button>
            ) : null}
            <Button variant="ghost" className="h-12 sm:h-11" onClick={onClose}>
              Later
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The end of the working day: check out, or keep working. */
function CheckOutDialog({
  status,
  onClose,
}: {
  status: AttendanceStatus;
  onClose: (snooze: boolean) => void;
}) {
  const router = useRouter();
  const { busy, state, problem, away, clock } = useSelfClock(status.date);
  const [leftAt, setLeftAt] = useState('');
  const [reporting, setReporting] = useState(false);
  // Decided once, when the window opens.
  const [ended] = useState(() =>
    status.shiftEndTime
      ? Date.now() >= new Date(`${status.date}T${status.shiftEndTime}:00+04:00`).getTime()
      : false,
  );

  async function report() {
    if (!status.recordId || !leftAt) return;
    setReporting(true);
    const form = new FormData();
    form.set('leftAt', leftAt);
    const result = await reportLeftAtAction(status.recordId, { ok: false }, form);
    setReporting(false);
    if (!result.ok) {
      toast.error(result.error ?? 'That could not be saved.');
      return;
    }
    toast.success('Saved — your manager will confirm it');
    router.refresh();
    onClose(false);
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose(ended)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlarmClock className="size-5 text-warning" />
            {ended ? `It’s past ${status.shiftEndTime} — the working day has ended` : 'Check out'}
          </DialogTitle>
          <DialogDescription>
            {status.clockInAt ? `You checked in at ${formatTime(status.clockInAt)}. ` : ''}
            {ended ? 'Leaving now? Check out from the workshop.' : 'Check out from the workshop when you leave.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {problem ? (
            <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {problem}
            </p>
          ) : null}
          {away && status.recordId ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-sm">Already left? Say what time, and your manager will confirm it.</p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="time"
                  value={leftAt}
                  onChange={(event) => setLeftAt(event.target.value)}
                  aria-label="Time you left"
                  className={cn(CONTROL, 'h-11 w-36')}
                />
                <Button variant="outline" className="h-11" onClick={report} disabled={!leftAt || reporting}>
                  {reporting ? 'Saving…' : 'Save the time'}
                </Button>
              </div>
            </div>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button className="h-12 text-base sm:h-11 sm:text-sm" onClick={async () => {
                cancelAnnouncement('CHECK_OUT_REMINDER');
                if (await clock('OUT')) onClose(false);
              }} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <LogOut />}
              {state === 'locating' ? 'Finding your location…' : state === 'sending' ? 'Saving…' : 'Check out'}
            </Button>
            <Button variant="ghost" className="h-12 sm:h-11" onClick={() => onClose(ended)}>
              {ended ? 'Still working — remind me in an hour' : 'Not yet'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function greeting() {
  const hour = Number(
    new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dubai', hour: 'numeric', hour12: false }),
  );
  return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
}
