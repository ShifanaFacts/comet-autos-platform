'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  LogIn,
  LogOut,
  Loader2,
  MoreHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AttendanceStatus } from '@/generated/prisma/enums';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormError } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { StatusPill } from '@/components/shared/status-pill';
import type { ActionResult } from '@/lib/errors';
import { formatTime } from '@/lib/format';
import { clockAction, markAttendanceAction } from '@/app/(app)/hr/attendance/actions';
import { cn } from '@/lib/utils';

const STATUS_TONE: Record<AttendanceStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  PRESENT: 'success',
  HALF_DAY: 'warning',
  ABSENT: 'danger',
  ON_LEAVE: 'neutral',
  HOLIDAY: 'neutral',
};

export interface RowData {
  employee: { id: string; name: string; code: string; jobTitle: string | null; branch: string };
  record: {
    id: string;
    clockInAt: Date | null;
    clockOutAt: Date | null;
    status: AttendanceStatus;
    notes: string | null;
  } | null;
  workedLabel: string;
  next: 'IN' | 'OUT' | 'DONE';
}

/*
 * One person's day.
 *
 * On a phone this is the whole feature: a name, the times, and one big
 * button that says the only thing that can happen next. No date picker, no
 * status dropdown, no typing — a technician with dirty hands taps once.
 *
 * Everything else (marking someone absent, on leave, or correcting a day)
 * is behind the second button, because it is what a supervisor does at a
 * desk, not what happens fifty times a morning.
 */
export function AttendanceRow({
  row,
  date,
  canEdit,
  statuses,
}: {
  row: RowData;
  date: string;
  canEdit: boolean;
  statuses: { value: AttendanceStatus; label: string; detail: string }[];
}) {
  const router = useRouter();
  const [isClocking, startClocking] = useTransition();
  const [marking, setMarking] = useState(false);

  function clock() {
    if (row.next === 'DONE') return;
    startClocking(async () => {
      const result = await clockAction(row.employee.id, row.next as 'IN' | 'OUT', date);
      if (!result.ok) {
        toast.error(result.error ?? 'That could not be recorded.');
        return;
      }
      toast.success(
        row.next === 'IN' ? `${row.employee.name} clocked in` : `${row.employee.name} clocked out`,
      );
      router.refresh();
    });
  }

  const times = row.record?.clockInAt
    ? `${formatTime(row.record.clockInAt)}${
        row.record.clockOutAt ? ` – ${formatTime(row.record.clockOutAt)}` : ' – still in'
      }`
    : null;

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
      <Link
        href={`/hr/attendance/${row.employee.id}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg transition-colors hover:text-primary"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{row.employee.name}</span>
            {row.record ? (
              <StatusPill tone={STATUS_TONE[row.record.status]}>
                {statuses.find((s) => s.value === row.record!.status)?.label ?? row.record.status}
              </StatusPill>
            ) : null}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            <span className="font-mono">{row.employee.code}</span>
            {row.employee.jobTitle ? ` · ${row.employee.jobTitle}` : ''}
          </span>
          {times ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3.5" />
              {times}
              {row.workedLabel !== '—' ? (
                <span className="font-medium text-foreground">· {row.workedLabel}</span>
              ) : null}
            </span>
          ) : null}
          {row.record?.notes ? (
            <span className="truncate text-xs text-muted-foreground">{row.record.notes}</span>
          ) : null}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground sm:hidden" />
      </Link>

      {canEdit ? (
        <div className="flex shrink-0 gap-2">
          {/* The one action, sized for a thumb. */}
          <button
            type="button"
            onClick={clock}
            disabled={isClocking || row.next === 'DONE'}
            className={cn(
              'inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl px-5 text-base font-medium transition-colors sm:h-11 sm:flex-none sm:text-sm',
              row.next === 'IN' && 'bg-primary text-primary-foreground hover:bg-primary-hover',
              row.next === 'OUT' && 'border border-border bg-card hover:bg-muted',
              row.next === 'DONE' && 'cursor-default text-success',
            )}
          >
            {isClocking ? (
              <Loader2 className="size-5 animate-spin" />
            ) : row.next === 'IN' ? (
              <LogIn className="size-5" />
            ) : row.next === 'OUT' ? (
              <LogOut className="size-5" />
            ) : (
              <CheckCircle2 className="size-5" />
            )}
            {row.next === 'IN' ? 'Clock in' : row.next === 'OUT' ? 'Clock out' : 'Done'}
          </button>

          <Button
            variant="outline"
            className="h-12 w-12 shrink-0 p-0 sm:h-11 sm:w-11"
            aria-label={`Record something else for ${row.employee.name}`}
            onClick={() => setMarking(true)}
          >
            <MoreHorizontal className="size-5" />
          </Button>
        </div>
      ) : null}

      <MarkDialog
        open={marking}
        onClose={() => setMarking(false)}
        row={row}
        date={date}
        statuses={statuses}
      />
    </li>
  );
}

/** Marking a day absent, on leave, a holiday — or correcting one. */
function MarkDialog({
  open,
  onClose,
  row,
  date,
  statuses,
}: {
  open: boolean;
  onClose: () => void;
  row: RowData;
  date: string;
  statuses: { value: AttendanceStatus; label: string; detail: string }[];
}) {
  const router = useRouter();
  const [status, setStatus] = useState<AttendanceStatus>(row.record?.status ?? 'ABSENT');
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await markAttendanceAction(row.employee.id, prev, formData);
      if (result.ok) {
        toast.success(`${row.employee.name}: ${statuses.find((s) => s.value === status)?.label}`);
        onClose();
        router.refresh();
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};
  const clearsTimes = status !== 'PRESENT' && status !== 'HALF_DAY';

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{row.employee.name}</DialogTitle>
          <DialogDescription>What should the day be recorded as?</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="status" value={status} />

          <div className="flex flex-col gap-2">
            {statuses.map((option) => (
              <label
                key={option.value}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3.5 transition-colors',
                  status === option.value
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-card hover:bg-muted/50',
                )}
              >
                <input
                  type="radio"
                  name="status-choice"
                  value={option.value}
                  checked={status === option.value}
                  onChange={() => setStatus(option.value)}
                  className="mt-0.5 size-5 shrink-0 accent-primary"
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium">{option.label}</span>
                  <span className="text-xs text-muted-foreground">{option.detail}</span>
                </span>
              </label>
            ))}
          </div>

          {clearsTimes && row.record?.clockInAt ? (
            <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-xs text-warning">
              The clocked times for this day will be cleared — a day someone was not here has no
              hours on it.
            </p>
          ) : null}

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Note</span>
            <input
              name="notes"
              defaultValue={row.record?.notes ?? ''}
              maxLength={300}
              placeholder="Optional — e.g. called in sick"
              className="h-12 w-full rounded-lg border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:h-11 md:text-sm"
            />
          </label>

          <FormError message={Object.keys(errors).length ? undefined : state.error} />

          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <SubmitButton pending={isPending} className="h-12 sm:h-11" pendingLabel="Saving…">
              Save the day
            </SubmitButton>
            <Button type="button" variant="ghost" className="h-12 sm:h-11" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
