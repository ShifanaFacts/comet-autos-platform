import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { hasPermission, requirePermission } from '@/lib/auth/authorize';
import { localDateString, parseCalendarDate } from '@/lib/format';
import { listEmployees } from '@/lib/hr/employees';
import { getAttendanceDay } from '@/lib/hr/attendance';
import { listLeave } from '@/lib/hr/leave';
import { canSeePay, getPayrollOverview } from '@/lib/hr/payroll';

/*
 * The team in full: who is employed and in which role, who is in today, who
 * is off, how attendance went this month, and — for whoever may see pay —
 * the monthly salary bill and the latest payroll run. Each part comes from
 * the HR module that owns it, with that module's own permission.
 */

export async function getHrOverview(user: AuthenticatedUser) {
  requirePermission(user, 'employee.view');
  const canAttendance = hasPermission(user, 'attendance.view');
  const canLeave = hasPermission(user, 'leave.view');
  const canPay = canSeePay(user);
  const today = localDateString();
  const monthStart = parseCalendarDate(`${today.slice(0, 7)}-01`)!;
  const todayDate = parseCalendarDate(today)!;

  const [employees, day, leave, payroll, month] = await Promise.all([
    listEmployees(user, { show: 'active' }),
    canAttendance ? getAttendanceDay(user) : null,
    canLeave ? listLeave(user, {}) : null,
    canPay ? getPayrollOverview(user) : null,
    canAttendance
      ? prisma.attendance.groupBy({
          by: ['status'],
          where: {
            organizationId: user.organizationId,
            attendanceDate: { gte: monthStart, lte: todayDate },
            employee: { isActive: true },
          },
          _count: { _all: true },
        })
      : null,
  ]);

  const roles = new Map<string, number>();
  for (const employee of employees) {
    const role = employee.designation?.name ?? employee.jobTitle ?? 'No role set';
    roles.set(role, (roles.get(role) ?? 0) + 1);
  }
  const monthCount = (status: string) =>
    month?.find((row) => row.status === status)?._count._all ?? 0;
  const worked = monthCount('PRESENT') + monthCount('HALF_DAY');
  const absent = monthCount('ABSENT');
  const latestRun = payroll?.runs.find((run) => run.status !== 'CANCELLED') ?? null;

  return {
    team: {
      active: employees.length,
      withLogin: employees.filter((employee) => employee.user).length,
      roles: [...roles.entries()]
        .map(([role, count]) => ({ role, count }))
        .sort((a, b) => b.count - a.count),
    },
    today: day ? day.totals : null,
    attendance: month
      ? {
          present: monthCount('PRESENT'),
          halfDays: monthCount('HALF_DAY'),
          absent,
          onLeave: monthCount('ON_LEAVE'),
          /** Of the working days recorded this month, the share attended. */
          rate: worked + absent > 0 ? Math.round((worked / (worked + absent)) * 1000) / 10 : null,
        }
      : null,
    leave: leave ? leave.totals : null,
    pay: payroll
      ? {
          monthly: payroll.monthly,
          missingSalary: payroll.missingSalary,
          latest: latestRun
            ? { label: latestRun.label, status: latestRun.status, totals: latestRun.totals }
            : null,
        }
      : null,
  };
}

export type HrOverview = Awaited<ReturnType<typeof getHrOverview>>;
