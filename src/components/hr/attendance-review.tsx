'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlarmClockOff } from 'lucide-react';
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
import { newRequestKey } from '@/lib/team/client';
import { reviewAttendanceAction } from '@/app/(app)/hr/attendance/actions';
import { cn } from '@/lib/utils';

export interface ReviewRow {
  id: string;
  date: string;
  employee: { id: string; name: string; code: string };
  clockInAt: Date | null;
  clockOutAt: Date | null;
  clockOutMethod: string | null;
  notes: string | null;
  shiftEndTime: string;
  workedLabel: string;
  open: boolean;
}

const dayName = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString('en-AE', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

const timeInput = (date: Date | null) =>
  date
    ? date.toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hour12: false })
    : '';

/**
 * Days whose check-out did not happen at the workshop: still open, closed
 * automatically at the shift end, or reported afterwards by the employee.
 * Confirm the time as it stands, or put the right one in.
 */
export function AttendanceReview({ rows }: { rows: ReviewRow[] }) {
  const [reviewing, setReviewing] = useState<ReviewRow | null>(null);
  if (rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-[17px] font-semibold">
        <AlarmClockOff className="size-5 text-warning" />
        Check-outs to confirm
        <span className="text-sm font-normal text-muted-foreground">{rows.length}</span>
      </h2>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium">
                {row.employee.name} · {dayName(row.date)}
              </span>
              <span className="text-xs text-muted-foreground">
                In {row.clockInAt ? formatTime(row.clockInAt) : '—'}
                {row.open
                  ? ' · no check-out yet'
                  : ` · out ${formatTime(row.clockOutAt!)} (${row.clockOutMethod === 'AUTO' ? `closed at the shift end, ${row.shiftEndTime}` : row.clockOutMethod === 'REPORTED' ? 'they reported this' : 'entered by hand'}) · ${row.workedLabel}`}
              </span>
              {row.notes ? <span className="truncate text-xs text-muted-foreground">{row.notes}</span> : null}
            </span>
            <Button variant="outline" className="h-11 shrink-0" onClick={() => setReviewing(row)}>
              {row.open ? 'Set check-out' : 'Review'}
            </Button>
          </li>
        ))}
      </ul>
      {reviewing ? <ReviewDialog row={reviewing} onClose={() => setReviewing(null)} /> : null}
    </section>
  );
}

function ReviewDialog({ row, onClose }: { row: ReviewRow; onClose: () => void }) {
  const router = useRouter();
  const [clockOut, setClockOut] = useState(timeInput(row.clockOutAt));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [requestKey] = useState(newRequestKey);
  const unchanged = clockOut === timeInput(row.clockOutAt);

  function save() {
    const form = new FormData();
    if (!unchanged) form.set('clockOut', clockOut);
    form.set('requestKey', requestKey);
    startTransition(async () => {
      const result = await reviewAttendanceAction(row.id, { ok: false }, form);
      if (!result.ok) {
        setError(result.error ?? 'It could not be saved.');
        return;
      }
      toast.success(unchanged ? 'Confirmed' : 'Corrected');
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {row.employee.name} · {dayName(row.date)}
          </DialogTitle>
          <DialogDescription>
            Checked in at {row.clockInAt ? formatTime(row.clockInAt) : '—'}. When did they leave?
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <input
            type="time"
            value={clockOut}
            onChange={(event) => setClockOut(event.target.value)}
            aria-label="Check-out time"
            className={cn(CONTROL, 'h-12 w-40 text-base')}
          />
          <FormError message={error ?? undefined} />
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button onClick={save} disabled={pending || !clockOut} className="h-12 sm:h-11">
              {pending ? 'Saving…' : unchanged ? 'Confirm this time' : 'Save corrected time'}
            </Button>
            <Button variant="ghost" className="h-12 sm:h-11" onClick={onClose}>
              Later
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
