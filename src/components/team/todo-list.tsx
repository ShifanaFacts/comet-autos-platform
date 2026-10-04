'use client';

import { useOptimistic, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CalendarClock,
  Check,
  ClipboardList,
  Image as ImageIcon,
  MessageSquare,
  Star,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import type { TaskPriority, TaskStatus } from '@/generated/prisma/enums';
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
import { StatusPill } from '@/components/shared/status-pill';
import { SpeechField, emptySpeech, type SpeechFieldValue } from '@/components/team/speech-field';
import { TASK_PRIORITY_LABEL, TASK_PRIORITY_TONE, isRtl } from '@/lib/team/labels';
import { addDays, newRequestKey } from '@/lib/team/client';
import {
  moveTaskAction,
  setTaskHighlightAction,
  setTaskStatusAction,
} from '@/app/(app)/team/actions';
import { cn } from '@/lib/utils';

/*
 * A to-do list that reads like one: a round box to tick, a line through
 * what is done, a star for what matters most today. Tasks a manager gave
 * are marked; a task moved to another day says so (and how often). Tapping
 * the text opens the task — its notes, photos, voice notes and history.
 */

export interface TodoItem {
  id: string;
  title: string;
  language: string | null;
  isAssigned: boolean;
  priority: TaskPriority;
  status: TaskStatus;
  dueKey: string | null;
  originalDueKey: string | null;
  timesMoved: number;
  highlighted: boolean;
  overdue: boolean;
  givenBy: string;
  assignee: { id: string; name: string };
  jobCard: { id: string; jobNumber: string; plate: string } | null;
  attachments: number;
  notes: number;
}

export interface TodoGroup {
  date: string;
  kind: 'overdue' | 'today' | 'upcoming' | 'day';
  tasks: TodoItem[];
  movedAway?: TodoItem[];
}

export interface RowAbilities {
  tick: boolean;
  star: boolean;
  move: boolean;
}

const dayLabel = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString('en-AE', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
const shortDay = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString('en-AE', { timeZone: 'UTC', day: 'numeric', month: 'short' });

export function headingFor(group: { date: string; kind: TodoGroup['kind'] }, today: string) {
  if (group.date === today) return `Today · ${dayLabel(group.date)}`;
  if (group.date === addDays(today, -1)) return `Yesterday · ${dayLabel(group.date)}`;
  if (group.date === addDays(today, 1)) return `Tomorrow · ${dayLabel(group.date)}`;
  return dayLabel(group.date);
}

export function TodoGroups({
  groups,
  today,
  showAssignee = false,
  abilities,
  emptyToday,
}: {
  groups: TodoGroup[];
  today: string;
  showAssignee?: boolean;
  /** What this viewer may do with each row, by task id. */
  abilities: Record<string, RowAbilities>;
  emptyToday?: string;
}) {
  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => {
        const pending = group.tasks.filter((task) => task.status !== 'DONE').length;
        return (
          <section key={group.date} className="flex flex-col gap-2">
            <h2
              className={cn(
                'flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2 text-[15px] font-semibold',
                group.kind === 'overdue' && 'text-danger',
              )}
            >
              <span>
                {headingFor(group, today)}
                {group.kind === 'overdue' ? (
                  <span className="ml-2 text-xs font-medium">still pending</span>
                ) : null}
              </span>
              <span className="text-xs font-normal text-muted-foreground tabular-nums">
                {group.tasks.length === 0
                  ? ''
                  : pending === 0
                    ? 'all done'
                    : `${pending} to do${group.tasks.length > pending ? ` · ${group.tasks.length - pending} done` : ''}`}
              </span>
            </h2>
            {group.tasks.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">{emptyToday ?? 'Nothing on this day.'}</p>
            ) : (
              <ul className="flex flex-col">
                {group.tasks.map((task) => (
                  <TodoRow
                    key={task.id}
                    task={task}
                    today={today}
                    showAssignee={showAssignee}
                    can={abilities[task.id] ?? { tick: false, star: false, move: false }}
                  />
                ))}
              </ul>
            )}
            {group.movedAway?.length ? (
              <div className="mt-2 flex flex-col gap-1 rounded-lg bg-muted/40 px-3 py-2.5">
                <p className="text-xs font-medium text-muted-foreground">Planned for this day, moved</p>
                {group.movedAway.map((task) => (
                  <Link
                    key={task.id}
                    href={`/team/tasks/${task.id}`}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <CalendarClock className="size-3.5 shrink-0" />
                    <span className="min-w-0 truncate">{task.title}</span>
                    <span className="shrink-0 text-xs">→ {task.dueKey ? shortDay(task.dueKey) : '—'}</span>
                  </Link>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function TodoRow({
  task,
  today,
  showAssignee,
  can,
}: {
  task: TodoItem;
  today: string;
  showAssignee: boolean;
  can: RowAbilities;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [view, setView] = useOptimistic(
    { status: task.status, highlighted: task.highlighted },
    (current, patch: Partial<{ status: TaskStatus; highlighted: boolean }>) => ({ ...current, ...patch }),
  );
  const [moving, setMoving] = useState(false);
  const done = view.status === 'DONE';
  const cancelled = view.status === 'CANCELLED';

  function tick() {
    if (!can.tick || cancelled) return;
    const next: TaskStatus = done ? 'TODO' : 'DONE';
    startTransition(async () => {
      setView({ status: next });
      const result = await setTaskStatusAction(task.id, next);
      if (!result.ok) toast.error(result.error ?? 'That could not be saved.');
      router.refresh();
    });
  }

  function star() {
    if (!can.star) return;
    startTransition(async () => {
      setView({ highlighted: !view.highlighted });
      const result = await setTaskHighlightAction(task.id, !view.highlighted);
      if (!result.ok) toast.error(result.error ?? 'That could not be saved.');
      router.refresh();
    });
  }

  return (
    <li
      className={cn(
        'group flex items-start gap-3 border-b border-border/60 py-3 last:border-b-0',
        view.highlighted && !done && '-mx-2 rounded-lg border-b-0 bg-warning/10 px-2 ring-1 ring-warning/30',
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark “${task.title}” not done` : `Mark “${task.title}” done`}
        disabled={!can.tick || cancelled}
        onClick={tick}
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
          done
            ? 'border-success bg-success text-white'
            : task.priority === 'URGENT'
              ? 'border-danger hover:bg-danger/10'
              : task.priority === 'HIGH'
                ? 'border-warning hover:bg-warning/10'
                : 'border-muted-foreground/50 hover:border-primary hover:bg-primary/5',
          !can.tick && 'cursor-default opacity-60',
        )}
      >
        {done ? <Check className="size-4" strokeWidth={3} /> : null}
      </button>

      <Link href={`/team/tasks/${task.id}`} className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
        <span
          dir={isRtl(task.language) ? 'rtl' : 'auto'}
          className={cn(
            'text-[15px] leading-snug break-words',
            done && 'text-muted-foreground line-through decoration-2',
            cancelled && 'text-muted-foreground line-through',
          )}
        >
          {task.title}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {showAssignee ? (
            <span className="inline-flex items-center gap-1 font-medium text-foreground/80">
              <UserRound className="size-3.5" />
              {task.assignee.name}
            </span>
          ) : null}
          {task.priority !== 'NORMAL' && !done ? (
            <StatusPill tone={TASK_PRIORITY_TONE[task.priority]} className="h-5 px-2 text-[11px]">
              {TASK_PRIORITY_LABEL[task.priority]}
            </StatusPill>
          ) : null}
          {task.isAssigned && !showAssignee ? <span>From {task.givenBy}</span> : null}
          {task.timesMoved > 0 ? (
            <span className="inline-flex items-center gap-1 text-warning">
              <CalendarClock className="size-3.5" />
              Moved{task.timesMoved > 1 ? ` ${task.timesMoved}×` : ''}
              {task.originalDueKey && task.originalDueKey !== task.dueKey
                ? ` · first due ${shortDay(task.originalDueKey)}`
                : ''}
            </span>
          ) : null}
          {task.overdue && task.dueKey ? (
            <span className="font-medium text-danger">Due {shortDay(task.dueKey)}</span>
          ) : null}
          {task.jobCard ? (
            <span className="inline-flex items-center gap-1">
              <ClipboardList className="size-3.5" />
              {task.jobCard.plate}
            </span>
          ) : null}
          {task.attachments ? (
            <span className="inline-flex items-center gap-1">
              <ImageIcon className="size-3.5" />
              {task.attachments}
            </span>
          ) : null}
          {task.notes ? (
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="size-3.5" />
              {task.notes}
            </span>
          ) : null}
          {cancelled ? <span>Cancelled</span> : null}
        </span>
      </Link>

      <div className="flex shrink-0 items-center">
        {can.move && !done && !cancelled ? (
          <button
            type="button"
            onClick={() => setMoving(true)}
            aria-label="Move to another day"
            title="Move to another day"
            className="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <CalendarClock className="size-[18px]" />
          </button>
        ) : null}
        {can.star && !cancelled ? (
          <button
            type="button"
            onClick={star}
            aria-pressed={view.highlighted}
            aria-label={view.highlighted ? 'Remove the star' : 'Star — highlight this'}
            className={cn(
              'flex size-10 items-center justify-center rounded-lg hover:bg-muted',
              view.highlighted ? 'text-warning' : 'text-muted-foreground',
            )}
          >
            <Star className={cn('size-[18px]', view.highlighted && 'fill-current')} />
          </button>
        ) : null}
      </div>

      {moving ? (
        <MoveDialog task={task} today={today} onClose={() => setMoving(false)} />
      ) : null}
    </li>
  );
}

/** Moving a task to another day: always with a reason, which stays in its history. */
export function MoveDialog({
  task,
  today,
  onClose,
}: {
  task: { id: string; title: string; dueKey: string | null; isAssigned: boolean };
  today: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const tomorrow = addDays(today, 1);
  const [date, setDate] = useState(task.dueKey && task.dueKey >= tomorrow ? addDays(task.dueKey, 1) : tomorrow);
  const [reason, setReason] = useState<SpeechFieldValue>(emptySpeech());
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [requestKey] = useState(newRequestKey);

  function save() {
    setError(null);
    if (reason.text.trim().length < 3) {
      setFieldErrors({ reason: 'Say why it is being moved.' });
      return;
    }
    const form = new FormData();
    form.set('dueDate', date);
    form.set('reason', reason.text.trim());
    form.set('language', reason.language);
    form.set('requestKey', requestKey);
    startTransition(async () => {
      const result = await moveTaskAction(task.id, { ok: false }, form);
      if (!result.ok) {
        setError(result.error ?? 'It could not be moved.');
        setFieldErrors(result.fieldErrors ?? {});
        return;
      }
      toast.success(`Moved to ${shortDay(date)}`);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Move to another day</DialogTitle>
          <DialogDescription>
            “{task.title}”
            {task.isAssigned ? ' was given to you — the move and your reason are shown to your manager.' : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            {task.dueKey !== tomorrow ? (
              <button
                type="button"
                onClick={() => setDate(tomorrow)}
                aria-pressed={date === tomorrow}
                className={cn(
                  'h-11 rounded-lg border px-4 text-sm font-medium',
                  date === tomorrow ? 'border-primary bg-primary/5 text-primary' : 'border-border bg-card',
                )}
              >
                Tomorrow
              </button>
            ) : null}
            <input
              type="date"
              value={date}
              min={today}
              onChange={(event) => setDate(event.target.value || tomorrow)}
              aria-label="New day"
              className={cn(CONTROL, 'h-11 w-44')}
            />
          </div>
          {fieldErrors.dueDate ? <p className="text-xs text-destructive">{fieldErrors.dueDate}</p> : null}

          <SpeechField
            id={`move-reason-${task.id}`}
            label="Why is it moving?"
            placeholder="e.g. Waiting for the part to arrive"
            rows={2}
            value={reason}
            onChange={setReason}
            allowKeepVoice={false}
            error={fieldErrors.reason}
          />

          <FormError message={error ?? undefined} />
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button type="button" onClick={save} disabled={pending} className="h-12 sm:h-11">
              {pending ? 'Moving…' : `Move to ${shortDay(date)}`}
            </Button>
            <Button type="button" variant="ghost" className="h-12 sm:h-11" onClick={onClose}>
              Keep it where it is
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
