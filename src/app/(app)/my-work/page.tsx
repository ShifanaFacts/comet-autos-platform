import Link from 'next/link';
import { ClipboardList, ListTodo, Plus, UserRoundX } from 'lucide-react';
import { requireUser } from '@/lib/auth/authorize';
import { getMyDay } from '@/lib/hr/self-attendance';
import { listMyTasks } from '@/lib/team/tasks';
import { localDateString } from '@/lib/format';
import { prisma } from '@/lib/prisma';
import { CLOSED_JOB_STATUSES, JOB_STATUS_LABEL } from '@/lib/workshop/stages';
import { PageHeader, Stack } from '@/components/layout/primitives';
import { EmptyState } from '@/components/shared/empty-state';
import { VehiclePlate } from '@/components/shared/vehicle-plate';
import { CheckInCard } from '@/components/team/check-in-card';
import { TodoGroups, type RowAbilities } from '@/components/team/todo-list';
import { DayNav } from '@/components/team/day-nav';

export const dynamic = 'force-dynamic';

/*
 * The employee's own screen, made for a phone: check in, see the day's
 * to-dos (with anything left from earlier days above them), tick them off,
 * add their own, and see the job cards they are on.
 */
export default async function MyWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await requireUser();
  const { date } = await searchParams;
  const [day, tasks] = await Promise.all([getMyDay(user), listMyTasks(user, date)]);

  if (!day || !tasks) {
    return (
      <Stack gap="2xl">
        <PageHeader eyebrow="Team" title="My work" />
        <EmptyState
          icon={UserRoundX}
          title="Your login isn’t linked to an employee"
          description="Attendance and a to-do list belong to an employee record. Ask the owner to link your login to your employee record in Settings → Users."
        />
      </Stack>
    );
  }

  const today = localDateString();
  const jobs = await prisma.jobCard.findMany({
    where: {
      organizationId: user.organizationId,
      status: { notIn: CLOSED_JOB_STATUSES },
      assignments: { some: { employeeId: day.employee.id, unassignedAt: null } },
    },
    orderBy: { openedAt: 'asc' },
    take: 20,
    select: {
      id: true,
      jobNumber: true,
      status: true,
      vehicle: { select: { plateNumber: true, make: true, model: true } },
    },
  });

  // Everything on this list is the person's own.
  const abilities: Record<string, RowAbilities> = Object.fromEntries(
    tasks.groups.flatMap((group) =>
      group.tasks.map((task) => [task.id, { tick: true, star: true, move: true }]),
    ),
  );

  return (
    <Stack gap="xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow="Team"
        title="My work"
        description={`${day.employee.name}${day.employee.jobTitle ? ` · ${day.employee.jobTitle}` : ''}`}
        actions={
          <Link
            href="/my-work/new"
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            <Plus className="size-4" />
            Add to-do
          </Link>
        }
      />

      {tasks.view === 'list' ? (
        <CheckInCard
          firstName={day.employee.firstName}
          day={{
            date: day.date,
            next: day.next,
            record: day.record,
            workedLabel: day.workedLabel,
            fenceSet: day.fence !== null,
            radiusM: day.fence?.radiusM ?? null,
            shiftEndTime: day.shiftEndTime,
            pastShiftEnd: day.pastShiftEnd,
            openEarlier: day.openEarlier,
            awaitingReview: day.awaitingReview,
          }}
        />
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="flex items-center gap-2 text-[17px] font-semibold">
              <ListTodo className="size-5 text-muted-foreground" />
              {tasks.view === 'day' ? 'That day' : 'To-do'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tasks.counts.open} open
              {tasks.counts.overdue ? ` · ${tasks.counts.overdue} from earlier days` : ''}. Tick the circle when
              it’s done; ★ to highlight; the calendar to move it.
            </p>
          </div>
          <DayNav basePath="/my-work" date={tasks.view === 'day' ? tasks.date : null} today={today} />
        </div>
        <TodoGroups
          groups={tasks.groups}
          today={today}
          abilities={abilities}
          emptyToday={tasks.view === 'list' ? 'Nothing for today yet. Add a to-do, or wait for a task.' : undefined}
        />
      </section>

      {jobs.length && tasks.view === 'list' ? (
        <section className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-[17px] font-semibold">
            <ClipboardList className="size-5 text-muted-foreground" />
            My job cards
          </h2>
          <ul className="flex flex-col gap-2">
            {jobs.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/job-cards/${job.id}`}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:bg-muted/50"
                >
                  <VehiclePlate plateNumber={job.vehicle.plateNumber} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">
                      {job.vehicle.make} {job.vehicle.model}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {job.jobNumber} · {JOB_STATUS_LABEL[job.status]}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Stack>
  );
}
