import type { JobCardStatus } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { localDateString, localDayRange, parseCalendarDate } from '@/lib/format';
import { CLOSED_JOB_STATUSES, JOB_STATUS_LABEL, normalizeStatus, type WorkflowStatus } from '@/lib/workshop/stages';
import { APPOINTMENT_STATUS_LABEL } from '@/lib/workshop/labels';
import { countOpenTasksByJob } from '@/lib/team/tasks';

/*
 * The workshop today, on one screen (/live): what is booked, every vehicle
 * in the workshop by where it stands, what is ready, what went home, and
 * who is in. Read when the page is opened, like every other screen.
 *
 * Jobs are grouped into five lanes rather than the twelve workflow steps —
 * at a glance, what matters is whether a car is waiting, being worked on or
 * ready.
 */

export type LaneKey = 'in' | 'approval' | 'work' | 'hold' | 'ready';

export const LANES: { key: LaneKey; label: string; statuses: WorkflowStatus[] }[] = [
  { key: 'in', label: 'Checked in', statuses: ['ARRIVED', 'INSPECTION', 'DIAGNOSIS'] },
  { key: 'approval', label: 'Quote / approval', statuses: ['ESTIMATE', 'WAITING_APPROVAL', 'REJECTED'] },
  { key: 'work', label: 'Being worked on', statuses: ['APPROVED', 'REPAIR', 'QUALITY_CHECK'] },
  { key: 'hold', label: 'On hold', statuses: ['ON_HOLD'] },
  { key: 'ready', label: 'Ready / to deliver', statuses: ['READY', 'INVOICED', 'PAID'] },
];

export function laneOf(status: JobCardStatus): LaneKey {
  const normal = normalizeStatus(status);
  return LANES.find((lane) => lane.statuses.includes(normal))?.key ?? 'in';
}

/** The board, for a signed-in user who may see job cards (their branch, if they have one). */
export async function getLiveBoard(user: AuthenticatedUser) {
  requirePermission(user, 'job_card.view');
  const organizationId = user.organizationId;
  const today = localDayRange();
  const scope = { organizationId, ...(user.primaryBranchId ? { branchId: user.primaryBranchId } : {}) };

  const [jobs, appointments, deliveredToday, arrivedToday, team] = await Promise.all([
    prisma.jobCard.findMany({
      where: { ...scope, status: { notIn: CLOSED_JOB_STATUSES } },
      orderBy: { openedAt: 'asc' },
      take: 200,
      select: {
        id: true,
        jobNumber: true,
        status: true,
        openedAt: true,
        customerComplaint: true,
        vehicle: { select: { plateNumber: true, make: true, model: true, color: true } },
        customer: { select: { name: true } },
        assignments: {
          where: { unassignedAt: null },
          orderBy: { assignmentRole: 'asc' },
          select: { employee: { select: { firstName: true } } },
        },
      },
    }),
    prisma.appointment.findMany({
      where: { ...scope, scheduledAt: { gte: today.start, lt: today.end }, status: { notIn: ['CANCELLED'] } },
      orderBy: { scheduledAt: 'asc' },
      take: 60,
      select: {
        id: true,
        scheduledAt: true,
        status: true,
        vehicle: { select: { plateNumber: true, make: true, model: true } },
        customer: { select: { name: true } },
      },
    }),
    prisma.jobCard.findMany({
      where: { ...scope, status: { in: ['DELIVERED', 'CLOSED'] }, deliveredAt: { gte: today.start, lt: today.end } },
      orderBy: { deliveredAt: 'desc' },
      take: 40,
      select: { id: true, jobNumber: true, deliveredAt: true, vehicle: { select: { plateNumber: true, make: true, model: true } } },
    }),
    prisma.jobCard.count({ where: { ...scope, openedAt: { gte: today.start, lt: today.end } } }),
    teamToday(scope),
  ]);

  const openTasks = await countOpenTasksByJob(organizationId, jobs.map((job) => job.id));
  const now = Date.now();

  const cards = jobs.map((job) => ({
    id: job.id,
    jobNumber: job.jobNumber,
    lane: laneOf(job.status),
    statusLabel: JOB_STATUS_LABEL[job.status],
    plate: job.vehicle.plateNumber,
    vehicle: [job.vehicle.make, job.vehicle.model].filter(Boolean).join(' '),
    color: job.vehicle.color,
    minutesIn: Math.max(0, Math.round((now - job.openedAt.getTime()) / 60_000)),
    customer: job.customer.name,
    complaint: job.customerComplaint ?? null,
    technicians: job.assignments.map((assignment) => assignment.employee.firstName),
    openTasks: openTasks.get(job.id) ?? 0,
  }));

  return {
    generatedAt: new Date(),
    counts: {
      appointments: appointments.filter((row) => row.status !== 'NO_SHOW').length,
      arrivedToday,
      inWorkshop: cards.length,
      working: cards.filter((card) => card.lane === 'work').length,
      ready: cards.filter((card) => card.lane === 'ready').length,
      deliveredToday: deliveredToday.length,
    },
    lanes: LANES.map((lane) => ({
      key: lane.key,
      label: lane.label,
      jobs: cards.filter((card) => card.lane === lane.key),
    })).filter((lane) => lane.key !== 'hold' || lane.jobs.length > 0),
    appointments: appointments.map((row) => ({
      id: row.id,
      scheduledAt: row.scheduledAt,
      statusLabel: APPOINTMENT_STATUS_LABEL[row.status],
      plate: row.vehicle?.plateNumber ?? null,
      vehicle: row.vehicle ? [row.vehicle.make, row.vehicle.model].filter(Boolean).join(' ') : null,
      customer: row.customer.name,
    })),
    delivered: deliveredToday.map((row) => ({
      id: row.id,
      deliveredAt: row.deliveredAt,
      plate: row.vehicle.plateNumber,
      vehicle: [row.vehicle.make, row.vehicle.model].filter(Boolean).join(' '),
    })),
    team,
  };
}

export type LiveBoard = Awaited<ReturnType<typeof getLiveBoard>>;

/** Who is in today and what they have open. */
async function teamToday(scope: { organizationId: string; branchId?: string }) {
  const today = parseCalendarDate(localDateString())!;
  const [employees, days, open] = await Promise.all([
    prisma.employee.findMany({
      where: { ...scope, isActive: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: 'asc' },
      take: 200,
    }),
    prisma.attendance.findMany({
      where: { ...scope, attendanceDate: today },
      select: { employeeId: true, clockInAt: true, clockOutAt: true },
    }),
    prisma.task.groupBy({
      by: ['assigneeEmployeeId'],
      where: { ...scope, status: { in: ['TODO', 'IN_PROGRESS'] } },
      _count: { _all: true },
    }),
  ]);
  const dayOf = new Map(days.map((day) => [day.employeeId, day]));
  const openOf = new Map(open.map((row) => [row.assigneeEmployeeId, row._count._all]));
  return employees.map((employee) => {
    const day = dayOf.get(employee.id);
    return {
      id: employee.id,
      name: `${employee.firstName} ${employee.lastName}`,
      in: !!day?.clockInAt && !day.clockOutAt,
      left: !!day?.clockOutAt,
      clockInAt: day?.clockInAt ?? null,
      openTasks: openOf.get(employee.id) ?? 0,
    };
  });
}
