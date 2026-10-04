'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarDays, CarFront, Expand, ListTodo, Minimize, UserRound, Wrench } from 'lucide-react';
import type { LiveBoard } from '@/lib/workshop/live-board';
import { cn } from '@/lib/utils';

/*
 * The workshop, live — for a phone, a desk, or a TV on the wall.
 *
 * It refreshes itself every 30 seconds (the server re-reads; nothing is
 * cached), and on a TV the Full screen button hides everything else. The
 * customer TV gets the same layout with only plates, cars and plain-word
 * statuses — the server never sends it anything more.
 */

const REFRESH_MS = 30_000;

const dubaiTime = (date: Date, seconds = false) =>
  date.toLocaleTimeString('en-AE', {
    timeZone: 'Asia/Dubai',
    hour: 'numeric',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
  });

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

export function LiveBoardView({ board, audience }: { board: LiveBoard; audience: 'staff' | 'public' }) {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const tv = audience === 'public' || fullscreen;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the clock starts after hydration
    setNow(new Date());
    const tick = setInterval(() => setNow(new Date()), 1000);
    const refresh = setInterval(() => router.refresh(), REFRESH_MS);
    const onChange = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
      document.removeEventListener('fullscreenchange', onChange);
    };
  }, [router]);

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.current?.requestFullscreen?.();
  }

  const counts = [
    { label: 'Appointments today', value: board.counts.appointments },
    { label: 'Arrived today', value: board.counts.arrivedToday },
    { label: 'In the workshop', value: board.counts.inWorkshop },
    { label: audience === 'public' ? 'In progress' : 'Being worked on', value: board.counts.working },
    { label: audience === 'public' ? 'Ready for collection' : 'Ready', value: board.counts.ready, tone: 'success' },
    { label: audience === 'public' ? 'Collected today' : 'Delivered today', value: board.counts.deliveredToday },
  ];

  return (
    <div
      ref={root}
      className={cn('@container flex flex-col gap-5 bg-background', tv && 'min-h-dvh overflow-y-auto p-5 lg:p-8')}
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            {board.workshopName}
          </p>
          <h1 className={cn('font-semibold tracking-tight', tv ? 'text-3xl lg:text-4xl' : 'text-2xl')}>
            {audience === 'public' ? 'Your vehicle — live status' : 'Workshop live'}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end">
            <span className={cn('font-semibold tabular-nums', tv ? 'text-3xl' : 'text-xl')}>
              {now ? dubaiTime(now, tv) : dubaiTime(new Date(board.generatedAt))}
            </span>
            <span className="text-xs text-muted-foreground">
              Updated {dubaiTime(new Date(board.generatedAt))} · refreshes every 30 s
            </span>
          </div>
          {audience === 'staff' ? (
            <button
              type="button"
              onClick={toggleFullscreen}
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted"
            >
              {fullscreen ? <Minimize className="size-4" /> : <Expand className="size-4" />}
              {fullscreen ? 'Exit' : 'Full screen (TV)'}
            </button>
          ) : null}
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-2 @2xl:grid-cols-3 @5xl:grid-cols-6">
        {counts.map((count) => (
          <div key={count.label} className="flex flex-col gap-1 rounded-xl border border-border/70 bg-card px-4 py-3">
            <dt className="text-xs font-medium text-muted-foreground">{count.label}</dt>
            <dd
              className={cn(
                'leading-none font-semibold tabular-nums',
                tv ? 'text-4xl' : 'text-2xl',
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
              <span className={cn('font-semibold', tv ? 'text-lg' : 'text-[15px]')}>{lane.label}</span>
              <span className="rounded-full bg-card px-2.5 py-0.5 text-sm font-semibold tabular-nums">
                {lane.jobs.length}
              </span>
            </h2>
            {lane.jobs.length === 0 ? (
              <p className="px-1 py-4 text-sm text-muted-foreground">None</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {lane.jobs.map((job) => {
                  const body = (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span
                          className={cn(
                            'rounded-md border-2 border-foreground/70 bg-secondary px-2 py-0.5 font-mono font-bold tracking-[0.12em]',
                            tv ? 'text-lg' : 'text-sm',
                          )}
                        >
                          {job.plate}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">in {sinceLabel(job.minutesIn)}</span>
                      </div>
                      <p className={cn('truncate font-medium', tv ? 'text-base' : 'text-sm')}>
                        {job.vehicle}
                        {job.color ? <span className="font-normal text-muted-foreground"> · {job.color}</span> : null}
                      </p>
                      <p className="text-xs font-medium text-primary">{job.statusLabel}</p>
                      {audience === 'staff' && 'customer' in job ? (
                        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                          <span className="truncate">
                            {job.jobNumber} · {job.customer}
                          </span>
                          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="inline-flex items-center gap-1">
                              <Wrench className="size-3.5" />
                              {job.technicians?.length ? job.technicians.join(', ') : 'Nobody assigned'}
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
                      ) : null}
                    </>
                  );
                  return (
                    <li key={job.id}>
                      {audience === 'staff' && !tv ? (
                        <Link
                          href={`/job-cards/${job.id}`}
                          className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3 hover:border-primary/40"
                        >
                          {body}
                        </Link>
                      ) : (
                        <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-3">
        <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 bg-card p-4 @4xl:col-span-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <CalendarDays className="size-4 text-muted-foreground" />
            Today’s appointments
          </h2>
          {board.appointments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No appointments today.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-x-6 @2xl:grid-cols-2">
              {board.appointments.map((row) => (
                <li key={row.id} className="flex items-center gap-3 border-b border-border/60 py-2 last:border-b-0">
                  <span className="w-16 shrink-0 text-sm font-semibold tabular-nums">{dubaiTime(new Date(row.scheduledAt))}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">
                      {row.plate ? <span className="font-mono">{row.plate}</span> : 'Vehicle to confirm'}
                      {row.vehicle ? <span className="font-normal text-muted-foreground"> · {row.vehicle}</span> : null}
                    </span>
                    {audience === 'staff' && 'customer' in row && row.customer ? (
                      <span className="truncate text-xs text-muted-foreground">{row.customer}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{row.statusLabel}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {audience === 'staff' && board.team ? (
          <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 bg-card p-4">
            <h2 className="flex items-center gap-2 font-semibold">
              <UserRound className="size-4 text-muted-foreground" />
              Team today
            </h2>
            <ul className="flex flex-col">
              {board.team.map((member) => (
                <li key={member.id} className="flex items-center gap-2 border-b border-border/60 py-2 text-sm last:border-b-0">
                  <span
                    aria-hidden
                    className={cn('size-2.5 shrink-0 rounded-full', member.in ? 'bg-success' : member.left ? 'bg-muted-foreground' : 'bg-border')}
                  />
                  <span className="min-w-0 flex-1 truncate">{member.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {member.in ? `in ${dubaiTime(new Date(member.clockInAt!))}` : member.left ? 'left' : 'not in'}
                    {member.openTasks ? ` · ${member.openTasks} open` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 bg-card p-4">
            <h2 className="flex items-center gap-2 font-semibold">
              <CarFront className="size-4 text-muted-foreground" />
              Collected today
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
                      <span className="shrink-0 text-xs text-muted-foreground">{dubaiTime(new Date(row.deliveredAt))}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
