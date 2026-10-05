import { prisma } from '@/lib/prisma';
import { localDateString, parseCalendarDate, formatTime } from '@/lib/format';
import { dubaiTimeOn } from '@/lib/team/geo';
import { notify } from '@/lib/notifications/service';

/*
 * The attendance reminders, sent by a scheduled job (the cron route calls
 * this every few minutes). Each is sent at most once per person per day —
 * the notification's dedupe key guarantees it — so running it often only
 * makes the reminders arrive on time.
 *
 *   From the start of the working day until its end: anyone with a login
 *   who hasn't checked in gets "It's check-in time" — unless today is
 *   marked absent, on leave or a holiday, or they have approved leave.
 *
 *   From the end of the working day: anyone still checked in gets "Your
 *   working day has ended — are you leaving?", and once more an hour later.
 *
 * Only branches with a location lock take part: without one nobody can
 * check in from a phone, so reminding them would only annoy.
 */

const HOUR = 60 * 60 * 1000;

export async function runAttendanceReminders(
  now = new Date(),
  /** Limit to one workshop — tests use this so they never reach real staff. */
  options: { organizationId?: string } = {},
) {
  const todayKey = localDateString(now);
  const today = parseCalendarDate(todayKey)!;
  const branches = await prisma.branch.findMany({
    where: {
      isActive: true,
      latitude: { not: null },
      organization: { isActive: true },
      ...(options.organizationId ? { organizationId: options.organizationId } : {}),
    },
    select: { id: true, organizationId: true, shiftStartTime: true, shiftEndTime: true },
  });

  let sent = 0;
  for (const branch of branches) {
    const start = dubaiTimeOn(todayKey, branch.shiftStartTime).getTime();
    const end = dubaiTimeOn(todayKey, branch.shiftEndTime).getTime();
    const t = now.getTime();
    if (t < start) continue;

    const employees = await prisma.employee.findMany({
      where: { organizationId: branch.organizationId, branchId: branch.id, isActive: true, userId: { not: null } },
      select: {
        id: true,
        firstName: true,
        userId: true,
        attendances: {
          where: { attendanceDate: today },
          select: { clockInAt: true, clockOutAt: true, status: true },
        },
        leaves: {
          where: { status: 'APPROVED', startDate: { lte: today }, endDate: { gte: today } },
          select: { id: true },
        },
      },
    });

    for (const employee of employees) {
      const day = employee.attendances[0];
      const away = !!day && ['ABSENT', 'ON_LEAVE', 'HOLIDAY'].includes(day.status);
      const base = { organizationId: branch.organizationId, userId: employee.userId! };

      if (t < end && !day?.clockInAt && !away && employee.leaves.length === 0) {
        const result = await notify({
          ...base,
          kind: 'CHECK_IN_REMINDER',
          title: `Good morning, ${employee.firstName} — it's check-in time`,
          body: 'Tap to check in at the workshop.',
          href: '/my-work',
          dedupeKey: `checkin:${todayKey}`,
        });
        if (result) sent += 1;
      }

      if (t >= end && day?.clockInAt && !day.clockOutAt) {
        const second = t >= end + HOUR;
        const result = await notify({
          ...base,
          kind: 'CHECK_OUT_REMINDER',
          title: second ? 'Still at the workshop?' : 'Your working day has ended',
          body: second
            ? 'Remember to check out when you leave.'
            : `You checked in at ${formatTime(day.clockInAt)}. Are you leaving? Tap to check out.`,
          href: '/my-work',
          dedupeKey: `${second ? 'checkout2' : 'checkout'}:${todayKey}`,
        });
        if (result) sent += 1;
      }
    }
  }
  return { branches: branches.length, sent };
}
