import Link from 'next/link';
import { ListTodo, Plus, Send, Users2 } from 'lucide-react';
import { AuthError, hasPermission, requireUser } from '@/lib/auth/authorize';
import { getTeamBoard, type TaskListItem, type TeamBoard } from '@/lib/team/tasks';
import { prisma } from '@/lib/prisma';
import { formatTime, localDateString } from '@/lib/format';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { EmptyState } from '@/components/shared/empty-state';
import { TodoGroups, type RowAbilities, type TodoGroup } from '@/components/team/todo-list';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Pending from earlier days' },
  { value: 'done', label: 'Done' },
  { value: 'all', label: 'All' },
] as const;

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'success' }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span
        className={cn(
          'text-2xl leading-none font-semibold tabular-nums',
          tone === 'danger' && 'text-danger',
          tone === 'success' && 'text-success',
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Tasks under a heading per day, oldest first — pending days stand out. */
function byDay(tasks: TaskListItem[], today: string): TodoGroup[] {
  const days = new Map<string, TaskListItem[]>();
  for (const task of tasks) {
    const key = task.status === 'DONE' ? (task.completedAt ? localDateString(task.completedAt) : today) : (task.dueKey ?? today);
    days.set(key, [...(days.get(key) ?? []), task]);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({
      date,
      kind: date < today && list.some((task) => task.overdue) ? 'overdue' : date === today ? 'today' : date > today ? 'upcoming' : 'day',
      tasks: list.sort((a, b) => Number(b.highlighted) - Number(a.highlighted)),
    }));
}

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ employee?: string; show?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  let board: TeamBoard;
  try {
    board = await getTeamBoard(user, params);
  } catch (error) {
    if (error instanceof AuthError) return <AccessDenied what="the team's tasks" />;
    throw error;
  }
  const canAssign = hasPermission(user, 'task.create');
  const canEditAll = hasPermission(user, 'task.edit');
  const today = localDateString();
  const me = await prisma.employee.findFirst({
    where: { organizationId: user.organizationId, userId: user.id },
    select: { id: true },
  });

  const abilities: Record<string, RowAbilities> = Object.fromEntries(
    board.tasks.map((task) => {
      const mine = task.assignee.id === me?.id;
      return [task.id, { tick: mine || canEditAll, move: mine || canEditAll, star: mine }];
    }),
  );
  const href = (patch: Partial<{ employee: string | undefined; show: string }>) => {
    const query = new URLSearchParams();
    const employee = 'employee' in patch ? patch.employee : board.filters.employee;
    const show = patch.show ?? board.filters.show;
    if (employee) query.set('employee', employee);
    if (show !== 'open') query.set('show', show);
    const text = query.toString();
    return text ? `/team?${text}` : '/team';
  };
  const chosen = board.team.find((member) => member.id === board.filters.employee);

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow="Team"
        title="Team tasks"
        description="Who is in today, what everyone has on, and what is still pending."
        actions={
          canAssign ? (
            <Link
              href={chosen ? `/team/new?for=${chosen.id}` : '/team/new'}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            >
              <Send className="size-4" />
              {chosen ? `Give ${chosen.name.split(' ')[0]} a task` : 'Give a task'}
            </Link>
          ) : null
        }
      />

      <Panel className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Figure label="In now" value={`${board.totals.in} / ${board.totals.team}`} />
        <Figure label="Open tasks" value={String(board.totals.open)} />
        <Figure label="Pending from earlier" value={String(board.totals.overdue)} tone={board.totals.overdue ? 'danger' : undefined} />
        <Figure label="Done today" value={String(board.totals.doneToday)} tone="success" />
      </Panel>

      {board.team.length === 0 ? (
        <EmptyState icon={Users2} title="No active employees" description="Add the team in HR → Employees first." />
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="text-[17px] font-semibold">The team today</h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {board.team.map((member) => {
              const active = member.id === board.filters.employee;
              return (
                <li key={member.id}>
                  <Link
                    href={href({ employee: active ? undefined : member.id })}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors',
                      active ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/50',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'size-2.5 shrink-0 rounded-full',
                        member.presence === 'IN' && 'bg-success',
                        member.presence === 'LEFT' && 'bg-muted-foreground',
                        member.presence === 'AWAY' && 'bg-warning',
                        member.presence === 'NOT_IN' && 'bg-border',
                      )}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{member.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {member.presence === 'IN'
                          ? `In since ${formatTime(member.clockInAt!)}`
                          : member.presence === 'LEFT'
                            ? `Left at ${formatTime(member.clockOutAt!)}`
                            : member.presence === 'AWAY'
                              ? 'Away today'
                              : 'Not checked in'}
                        {member.jobTitle ? ` · ${member.jobTitle}` : ''}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end text-xs tabular-nums">
                      <span className="font-medium">{member.open} open</span>
                      {member.overdue ? <span className="text-danger">{member.overdue} pending</span> : null}
                      {member.doneToday ? <span className="text-success">{member.doneToday} done</span> : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[17px] font-semibold">
            <ListTodo className="size-5 text-muted-foreground" />
            {chosen ? `${chosen.name}’s tasks` : 'Everyone’s tasks'}
          </h2>
          <nav className="flex flex-wrap gap-1 rounded-lg bg-muted p-1" aria-label="Show">
            {FILTERS.map((filter) => (
              <Link
                key={filter.value}
                href={href({ show: filter.value })}
                aria-current={board.filters.show === filter.value ? 'page' : undefined}
                className={cn(
                  'inline-flex h-9 items-center rounded-md px-3 text-sm',
                  board.filters.show === filter.value ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {filter.label}
              </Link>
            ))}
          </nav>
        </div>
        {board.tasks.length === 0 ? (
          <EmptyState
            icon={ListTodo}
            title="Nothing here"
            description={board.filters.show === 'overdue' ? 'Nothing is pending from earlier days.' : 'No tasks match.'}
            action={
              canAssign ? (
                <Link href="/team/new" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                  <Plus className="size-4" />
                  Give a task
                </Link>
              ) : undefined
            }
          />
        ) : (
          <TodoGroups groups={byDay(board.tasks, today)} today={today} showAssignee abilities={abilities} />
        )}
      </section>
    </Stack>
  );
}
