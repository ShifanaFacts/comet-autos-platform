import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  CalendarClock,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Mic,
  Pencil,
  RotateCcw,
  Star,
  UserRound,
  XCircle,
} from 'lucide-react';
import { hasPermission, requireUser } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { getTask, listOpenJobCardsForTasks, type TaskDetail } from '@/lib/team/tasks';
import { prisma } from '@/lib/prisma';
import { formatCalendarDate, formatDateTime, localDateString } from '@/lib/format';
import {
  TASK_PRIORITY_LABEL,
  TASK_PRIORITY_TONE,
  TASK_STATUS_LABEL,
  TASK_STATUS_TONE,
  isRtl,
  languageLabel,
} from '@/lib/team/labels';
import { PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { StatusPill } from '@/components/shared/status-pill';
import { VehiclePlate } from '@/components/shared/vehicle-plate';
import { NoteComposer, TaskActions } from '@/components/team/task-actions';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type Doc = TaskDetail['documents'][number];

const FIELD_LABEL: Record<string, string> = {
  title: 'Task',
  details: 'Details',
  dueDate: 'Day',
  priority: 'Priority',
  jobCardId: 'Job card',
  assigneeEmployeeId: 'For',
};

/** Photos as thumbnails that open full size; voice notes as players. */
function Media({ documents }: { documents: Doc[] }) {
  if (!documents.length) return null;
  const photos = documents.filter((doc) => doc.documentType === 'PHOTO');
  const voices = documents.filter((doc) => doc.documentType === 'VOICE_NOTE');
  return (
    <div className="flex flex-col gap-2">
      {voices.map((doc) => (
        <div key={doc.id} className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
          <Mic className="size-4 shrink-0 text-muted-foreground" />
          <audio controls preload="none" src={`/team/files/${doc.id}`} className="h-10 min-w-0 flex-1" />
        </div>
      ))}
      {photos.length ? (
        <ul className="flex flex-wrap gap-2">
          {photos.map((doc) => (
            <li key={doc.id}>
              <a href={`/team/files/${doc.id}`} target="_blank" rel="noreferrer" className="block size-24 overflow-hidden rounded-lg bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/team/files/${doc.id}`} alt="Photo on the task" loading="lazy" className="size-full object-cover" />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  let task: TaskDetail;
  try {
    task = await getTask(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const today = localDateString();
  const [jobCards, employees] = await Promise.all([
    task.can.edit ? listOpenJobCardsForTasks(user) : Promise.resolve([]),
    task.can.reassign && hasPermission(user, 'task.view')
      ? prisma.employee
          .findMany({
            where: { organizationId: user.organizationId, isActive: true },
            select: { id: true, firstName: true, lastName: true },
            orderBy: { firstName: 'asc' },
          })
          .then((rows) => rows.map((row) => ({ id: row.id, name: `${row.firstName} ${row.lastName}` })))
      : Promise.resolve([]),
  ]);

  const taskMedia = task.documents.filter((doc) => doc.entityType === 'Task');
  const mediaOf = (updateId: string) =>
    task.documents.filter((doc) => doc.entityType === 'TaskUpdate' && doc.entityId === updateId);
  const rtl = isRtl(task.language);
  const back = task.mine ? '/my-work' : '/team';

  return (
    <Stack gap="xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link href={back} className="hover:text-foreground">
            {task.mine ? 'My work' : 'Team tasks'}
          </Link>
        }
        title={
          <span dir={rtl ? 'rtl' : 'auto'} className={cn(task.status === 'DONE' && 'line-through decoration-2 opacity-70')}>
            {task.title}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill tone={TASK_STATUS_TONE[task.status]}>{TASK_STATUS_LABEL[task.status]}</StatusPill>
            {task.priority !== 'NORMAL' ? (
              <StatusPill tone={TASK_PRIORITY_TONE[task.priority]}>{TASK_PRIORITY_LABEL[task.priority]}</StatusPill>
            ) : null}
            {task.highlighted ? (
              <StatusPill tone="warning">
                <Star className="mr-1 size-3 fill-current" />
                Starred
              </StatusPill>
            ) : null}
            {task.overdue ? <StatusPill tone="danger">Pending since {formatCalendarDate(task.dueDate!)}</StatusPill> : null}
          </span>
        }
      />

      <TaskActions
        task={{
          id: task.id,
          title: task.title,
          details: task.details,
          status: task.status,
          priority: task.priority,
          dueKey: task.dueKey,
          isAssigned: task.isAssigned,
          highlighted: task.highlighted,
          jobCardId: task.jobCard?.id ?? null,
          assigneeId: task.assigneeEmployeeId,
          mine: task.mine,
        }}
        can={task.can}
        today={today}
        employees={employees}
        jobCards={jobCards}
      />

      <Panel className="flex flex-col gap-5">
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-medium text-muted-foreground">For</dt>
            <dd className="flex items-center gap-1.5">
              <UserRound className="size-4 text-muted-foreground" />
              {task.assignee.firstName} {task.assignee.lastName}
              {task.assignee.jobTitle ? <span className="text-muted-foreground">· {task.assignee.jobTitle}</span> : null}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-medium text-muted-foreground">Day</dt>
            <dd>
              {task.dueDate ? formatCalendarDate(task.dueDate) : '—'}
              {task.timesMoved > 0 ? (
                <span className="ml-2 text-xs text-warning">
                  moved {task.timesMoved}×
                  {task.originalDueDate ? ` · first due ${formatCalendarDate(task.originalDueDate)}` : ''}
                </span>
              ) : null}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs font-medium text-muted-foreground">{task.isAssigned ? 'Given by' : 'Added by'}</dt>
            <dd>
              {task.createdBy.fullName} · {formatDateTime(task.createdAt)}
            </dd>
          </div>
          {task.jobCard ? (
            <div className="flex flex-col gap-1">
              <dt className="text-xs font-medium text-muted-foreground">Job card</dt>
              <dd>
                <Link href={`/job-cards/${task.jobCard.id}`} className="inline-flex items-center gap-2 hover:text-primary">
                  <VehiclePlate plateNumber={task.jobCard.vehicle.plateNumber} className="text-xs" />
                  {task.jobCard.jobNumber}
                </Link>
              </dd>
            </div>
          ) : null}
        </dl>
        {task.details ? (
          <p dir={rtl ? 'rtl' : 'auto'} className="text-[15px] leading-relaxed whitespace-pre-wrap">
            {task.details}
          </p>
        ) : null}
        {task.language && languageLabel(task.language) !== 'English' ? (
          <p className="text-xs text-muted-foreground">Written in {languageLabel(task.language)}.</p>
        ) : null}
        <Media documents={taskMedia} />
      </Panel>

      <Section title="History & notes" description="Everything said and done on this task, oldest first. Nothing here is ever edited.">
        <ol className="flex flex-col gap-4">
          {task.updates.map((update) => {
            const media = mediaOf(update.id);
            const Icon =
              update.kind === 'MOVED'
                ? CalendarClock
                : update.kind === 'CHANGED'
                  ? Pencil
                  : update.toStatus === 'DONE'
                    ? CheckCircle2
                    : update.toStatus === 'CANCELLED'
                      ? XCircle
                      : update.toStatus === 'TODO'
                        ? RotateCcw
                        : update.kind === 'STATUS'
                          ? CircleDot
                          : ClipboardList;
            const moved = update.kind === 'MOVED' ? (update.changes as { dueDate?: [string | null, string] } | null)?.dueDate : null;
            const changes = update.kind === 'CHANGED' ? Object.keys((update.changes as Record<string, unknown>) ?? {}) : [];
            return (
              <li key={update.id} className="flex gap-3">
                <span
                  className={cn(
                    'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
                    update.kind === 'MOVED' ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground',
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <p className="text-sm">
                    <span className="font-medium">{update.author.fullName}</span>{' '}
                    <span className="text-muted-foreground">
                      {update.kind === 'MOVED' && moved
                        ? `moved it${moved[0] ? ` from ${formatCalendarDate(`${moved[0]}T00:00:00Z`)}` : ''} to ${formatCalendarDate(`${moved[1]}T00:00:00Z`)}`
                        : update.kind === 'STATUS' && update.toStatus
                          ? `→ ${TASK_STATUS_LABEL[update.toStatus]}`
                          : update.kind === 'CHANGED'
                            ? `changed ${changes.map((field) => FIELD_LABEL[field] ?? field).join(', ').toLowerCase()}`
                            : 'added a note'}
                      {' · '}
                      {formatDateTime(update.createdAt)}
                    </span>
                  </p>
                  {update.body ? (
                    <p
                      dir={isRtl(update.language) ? 'rtl' : 'auto'}
                      className={cn(
                        'rounded-lg px-3 py-2 text-[15px] leading-relaxed whitespace-pre-wrap',
                        update.kind === 'MOVED' ? 'bg-warning/5' : 'bg-muted/50',
                      )}
                    >
                      {update.kind === 'MOVED' ? <span className="font-medium">Reason: </span> : null}
                      {update.body}
                    </p>
                  ) : null}
                  <Media documents={media} />
                </div>
              </li>
            );
          })}
          {task.updates.length === 0 ? <li className="text-sm text-muted-foreground">Nothing yet.</li> : null}
        </ol>
      </Section>

      {task.can.comment ? (
        <Panel>
          <NoteComposer taskId={task.id} />
        </Panel>
      ) : null}
    </Stack>
  );
}
