import Link from 'next/link';
import { ChevronRight, Gauge, ListTodo, LogIn } from 'lucide-react';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/authorize';
import { getMyDay, SELF_CHECK_IN } from '@/lib/hr/self-attendance';
import { prisma } from '@/lib/prisma';
import { formatTime, localDateString, parseCalendarDate } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * The top of the dashboard for anyone with an employee record: am I
 * checked in, and what is on my list — one tap to My work. And, for staff
 * who see job cards, the way to the live board.
 */
export async function MyDayStrip({ user }: { user: AuthenticatedUser }) {
  const day = await getMyDay(user);
  const canLive = hasPermission(user, 'job_card.view');
  if (!day && !canLive) return null;

  const today = parseCalendarDate(localDateString())!;
  const [open, pending] = day
    ? await Promise.all([
        prisma.task.count({
          where: { organizationId: user.organizationId, assigneeEmployeeId: day.employee.id, status: { in: ['TODO', 'IN_PROGRESS'] } },
        }),
        prisma.task.count({
          where: {
            organizationId: user.organizationId,
            assigneeEmployeeId: day.employee.id,
            status: { in: ['TODO', 'IN_PROGRESS'] },
            dueDate: { lt: today },
          },
        }),
      ])
    : [0, 0];

  const tile =
    'flex min-h-16 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-muted/50';

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {day ? (
        <>
          {SELF_CHECK_IN ? (
            <Link href="/my-work" className={cn(tile, day.next === 'IN' && day.fence && 'border-primary/40 bg-primary/5')}>
              <LogIn className="size-5 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">
                  {day.next === 'IN' ? 'Not checked in' : day.next === 'OUT' ? 'Checked in' : 'Day done'}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {day.record?.clockInAt ? `In at ${formatTime(day.record.clockInAt)}` : 'Tap to check in at the workshop'}
                  {day.openEarlier ? ' · a past day needs a check-out time' : ''}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          ) : null}
          <Link href="/my-work" className={tile}>
            <ListTodo className="size-5 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium">
                {open === 0 ? 'Nothing on my list' : `${open} to do`}
              </span>
              <span className={cn('truncate text-xs', pending ? 'text-danger' : 'text-muted-foreground')}>
                {pending ? `${pending} pending from earlier days` : 'My work'}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </>
      ) : null}
      {canLive ? (
        <Link href="/live" className={tile}>
          <Gauge className="size-5 shrink-0 text-muted-foreground" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-medium">Workshop today</span>
            <span className="truncate text-xs text-muted-foreground">Every car in, by status, and who is in</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      ) : null}
    </div>
  );
}
