import Link from 'next/link';
import { CalendarDays, CarFront, ListTodo, UserRound, Wrench } from 'lucide-react';
import type { LiveBoard } from '@/lib/workshop/live-board';
import { formatTime } from '@/lib/format';
import { PageHeader } from '@/components/layout/primitives';
import { cn } from '@/lib/utils';

/*
 * The workshop today: counts, every car in by lane, today's appointments,
 * what went home, and who is in. Read when the page is opened, like every
 * other screen.
 */

function sinceLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
  const days = Math.floor(minutes / (24 * 60));
  return `${days} day${days === 1 ? '' : 's'}`;
}

const LANE_TONE: Record<string, string> = {
  in: 'border-t-info',
  approval: 'border-t-warning',
  work: 'border-t-primary',
  hold: 'border-t-muted-foreground',
  ready: 'border-t-success',
};

export function LiveBoardView({ board }: { board: LiveBoard }) {
  const counts = [
    { label: 'Appointments today', value: board.counts.appointments },
    { label: 'Arrived today', value: board.counts.arrivedToday },
    { label: 'In the workshop', value: board.counts.inWorkshop },
    { label: 'Being worked on', value: board.counts.working },
    { label: 'Ready', value: board.counts.ready, tone: 'success' },
    { label: 'Delivered today', value: board.counts.deliveredToday },
  ];

  return (
    <div className="@container flex flex-col gap-6">
      <PageHeader
        eyebrow="Workshop"
        title="Workshop today"
        description={`Every car in, by where it stands — as of ${formatTime(board.generatedAt)}.`}
      />

      <dl className="grid grid-cols-2 gap-2 @2xl:grid-cols-3 @5xl:grid-cols-6">
        {counts.map((count) => (
          <div key={count.label} className="flex flex-col gap-1 rounded-xl border border-border/70 bg-card px-4 py-3">
            <dt className="text-xs font-medium text-muted-foreground">{count.label}</dt>
            <dd
              className={cn(
                'text-2xl leading-none font-semibold tabular-nums',
                count.tone === 'success' && 'text-success',
              )}
            >
              {count.value}
            </dd>
          </div>
        ))}
      </dl>

      <div
        className={cn(
          'grid grid-cols-1 gap-3 @2xl:grid-cols-2',
          board.lanes.length >= 5 ? '@6xl:grid-cols-5' : '@5xl:grid-cols-4',
        )}
      >
        {board.lanes.map((lane) => (
          <section
            key={lane.key}
            className={cn('flex min-w-0 flex-col gap-2 rounded-xl border border-t-4 border-border/70 bg-muted/30 p-3', LANE_TONE[lane.key])}
          >
            <h2 className="flex items-center justify-between gap-2 px-1">
              <span className="text-[15px] font-semibold">{lane.label}</span>
              <span className="rounded-full bg-card px-2.5 py-0.5 text-sm font-semibold tabular-nums">
                {lane.jobs.length}
              </span>
            </h2>
            {lane.jobs.length === 0 ? (
              <p className="px-1 py-4 text-sm text-muted-foreground">None</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {lane.jobs.map((job) => (
                  <li key={job.id}>
                    <Link
                      href={`/job-cards/${job.id}`}
                      className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3 hover:border-primary/40"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="rounded-md border-2 border-foreground/70 bg-secondary px-2 py-0.5 font-mono text-sm font-bold tracking-[0.12em]">
                          {job.plate}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">in {sinceLabel(job.minutesIn)}</span>
                      </div>
                      <p className="truncate text-sm font-medium">
                        {job.vehicle}
                        {job.color ? <span className="font-normal text-muted-foreground"> · {job.color}</span> : null}
                      </p>
                      <p className="text-xs font-medium text-primary">{job.statusLabel}</p>
                      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                        <span className="truncate">
                          {job.jobNumber} · {job.customer}
                        </span>
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="inline-flex items-center gap-1">
                            <Wrench className="size-3.5" />
                            {job.technicians.length ? job.technicians.join(', ') : 'Nobody assigned'}
                          </span>
                          {job.openTasks ? (
                            <span className="inline-flex items-center gap-1 text-warning">
                              <ListTodo className="size-3.5" />
                              {job.openTasks} task{job.openTasks === 1 ? '' : 's'}
                            </span>
                          ) : null}
                        </span>
                        {job.complaint ? <span className="line-clamp-2">{job.complaint}</span> : null}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-3">
        <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 bg-card p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <CalendarDays className="size-4 text-muted-foreground" />
            Today’s appointments
          </h2>
          {board.appointments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No appointments today.</p>
          ) : (
            <ul className="flex flex-col">
              {board.appointments.map((row) => (
                <li key={row.id} className="flex items-center gap-3 border-b border-border/60 py-2 last:border-b-0">
                  <span className="w-16 shrink-0 text-sm font-semibold tabular-nums">{formatTime(row.scheduledAt)}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">
                      {row.plate ? <span className="font-mono">{row.plate}</span> : 'Vehicle to confirm'}
                      {row.vehicle ? <span className="font-normal text-muted-foreground"> · {row.vehicle}</span> : null}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{row.customer}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{row.statusLabel}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 bg-card p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <CarFront className="size-4 text-muted-foreground" />
            Delivered today
          </h2>
          {board.delivered.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            <ul className="flex flex-col">
              {board.delivered.map((row) => (
                <li key={row.id} className="flex items-center gap-3 border-b border-border/60 py-2 text-sm last:border-b-0">
                  <span className="font-mono font-semibold">{row.plate}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.vehicle}</span>
                  {row.deliveredAt ? (
                    <span className="shrink-0 text-xs text-muted-foreground">{formatTime(row.deliveredAt)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 bg-card p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <UserRound className="size-4 text-muted-foreground" />
            Team today
          </h2>
          {board.team.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active employees.</p>
          ) : (
            <ul className="flex flex-col">
              {board.team.map((member) => (
                <li key={member.id} className="flex items-center gap-2 border-b border-border/60 py-2 text-sm last:border-b-0">
                  <span
                    aria-hidden
                    className={cn('size-2.5 shrink-0 rounded-full', member.in ? 'bg-success' : member.left ? 'bg-muted-foreground' : 'bg-border')}
                  />
                  <span className="min-w-0 flex-1 truncate">{member.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {member.in ? `in ${formatTime(member.clockInAt!)}` : member.left ? 'left' : 'not in'}
                    {member.openTasks ? ` · ${member.openTasks} open` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
