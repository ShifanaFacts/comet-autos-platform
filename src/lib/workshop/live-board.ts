import { createHash, randomBytes } from 'node:crypto';
import type { JobCardStatus } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { localDateString, localDayRange, parseCalendarDate } from '@/lib/format';
import { CLOSED_JOB_STATUSES, JOB_STATUS_LABEL, normalizeStatus, type WorkflowStatus } from '@/lib/workshop/stages';
import { APPOINTMENT_STATUS_LABEL } from '@/lib/workshop/labels';
import { countOpenTasksByJob } from '@/lib/team/tasks';

/*
 * The workshop, live: what is booked today, every vehicle in the workshop
 * by where it stands, what is ready, what went home today.
 *
 * Two audiences read the same data:
 *
 *  - staff (/live), signed in with job_card.view — job numbers, customer
 *    names, the technician on it, open tasks, how long it has been in;
 *  - the TV in the waiting area (/display/<token>), not signed in — plate,
 *    make and model, and where the car stands in words a customer reads.
 *    No names, phone numbers, prices or notes ever reach that screen.
 *
 * Jobs are grouped into five lanes rather than the twelve workflow steps:
 * a customer cares whether their car is waiting, being worked on or ready,
 * not whether it is in diagnosis or inspection.
 */

export type LaneKey = 'in' | 'approval' | 'work' | 'hold' | 'ready';

export const LANES: { key: LaneKey; staff: string; public: string; statuses: WorkflowStatus[] }[] = [
  { key: 'in', staff: 'Checked in', public: 'Checked in', statuses: ['ARRIVED', 'INSPECTION', 'DIAGNOSIS'] },
  {
    key: 'approval',
    staff: 'Quote / approval',
    public: 'Awaiting approval',
    statuses: ['ESTIMATE', 'WAITING_APPROVAL', 'REJECTED'],
  },
  { key: 'work', staff: 'Being worked on', public: 'In progress', statuses: ['APPROVED', 'REPAIR', 'QUALITY_CHECK'] },
  { key: 'hold', staff: 'On hold', public: 'On hold', statuses: ['ON_HOLD'] },
  { key: 'ready', staff: 'Ready / to deliver', public: 'Ready for collection', statuses: ['READY', 'INVOICED', 'PAID'] },
];

export function laneOf(status: JobCardStatus): LaneKey {
  const normal = normalizeStatus(status);
  return LANES.find((lane) => lane.statuses.includes(normal))?.key ?? 'in';
}

interface BoardOptions {
  /** Limit to one branch (a branch-bound user, or a TV link). */
  branchId?: string | null;
  audience: 'staff' | 'public';
}

export async function loadLiveBoard(organizationId: string, options: BoardOptions) {
  const staff = options.audience === 'staff';
  const today = localDayRange();
  const branch = options.branchId ? { branchId: options.branchId } : {};
  const scope = { organizationId, ...branch };

  const [jobs, appointments, deliveredToday, arrivedToday, organization, team] = await Promise.all([
    prisma.jobCard.findMany({
      where: { ...scope, status: { notIn: CLOSED_JOB_STATUSES } },
      orderBy: { openedAt: 'asc' },
      take: 200,
      select: {
        id: true,
        jobNumber: true,
        status: true,
        openedAt: true,
        updatedAt: true,
        customerComplaint: true,
        vehicle: { select: { plateNumber: true, make: true, model: true, color: true } },
        // Read for both audiences; only the staff board ever puts them out.
        customer: { select: { name: true } },
        assignments: {
          where: { unassignedAt: null },
          orderBy: { assignmentRole: 'asc' },
          select: { assignmentRole: true, employee: { select: { firstName: true } } },
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
        notes: true,
      },
    }),
    prisma.jobCard.findMany({
      where: { ...scope, status: { in: ['DELIVERED', 'CLOSED'] }, deliveredAt: { gte: today.start, lt: today.end } },
      orderBy: { deliveredAt: 'desc' },
      take: 40,
      select: { id: true, jobNumber: true, deliveredAt: true, vehicle: { select: { plateNumber: true, make: true, model: true } } },
    }),
    prisma.jobCard.count({ where: { ...scope, openedAt: { gte: today.start, lt: today.end } } }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    staff ? teamToday(organizationId, options.branchId ?? null) : Promise.resolve(null),
  ]);

  const openTasks = staff ? await countOpenTasksByJob(organizationId, jobs.map((job) => job.id)) : new Map<string, number>();
  const now = Date.now();

  const cards = jobs.map((job) => {
    const lane = laneOf(job.status);
    return {
      id: job.id,
      jobNumber: job.jobNumber,
      lane,
      statusLabel: staff ? JOB_STATUS_LABEL[job.status] : LANES.find((entry) => entry.key === lane)!.public,
      plate: job.vehicle.plateNumber,
      vehicle: [job.vehicle.make, job.vehicle.model].filter(Boolean).join(' '),
      color: job.vehicle.color,
      openedAt: job.openedAt,
      minutesIn: Math.max(0, Math.round((now - job.openedAt.getTime()) / 60_000)),
      ...(staff
        ? {
            customer: job.customer.name,
            complaint: job.customerComplaint ?? null,
            technicians: job.assignments.map((assignment) => assignment.employee.firstName),
            openTasks: openTasks.get(job.id) ?? 0,
            updatedAt: job.updatedAt,
          }
        : {}),
    };
  });

  const lanes = LANES.map((lane) => ({
    key: lane.key,
    label: staff ? lane.staff : lane.public,
    jobs: cards.filter((card) => card.lane === lane.key),
  })).filter((lane) => lane.key !== 'hold' || lane.jobs.length > 0);

  return {
    workshopName: organization?.name ?? 'Workshop',
    generatedAt: new Date(),
    date: localDateString(),
    counts: {
      appointments: appointments.filter((row) => row.status !== 'NO_SHOW').length,
      arrivedToday,
      inWorkshop: cards.length,
      working: cards.filter((card) => card.lane === 'work').length,
      waitingApproval: cards.filter((card) => card.lane === 'approval').length,
      ready: cards.filter((card) => card.lane === 'ready').length,
      deliveredToday: deliveredToday.length,
    },
    lanes,
    appointments: appointments.map((row) => ({
      id: row.id,
      scheduledAt: row.scheduledAt,
      status: row.status,
      statusLabel: APPOINTMENT_STATUS_LABEL[row.status],
      plate: row.vehicle?.plateNumber ?? null,
      vehicle: row.vehicle ? [row.vehicle.make, row.vehicle.model].filter(Boolean).join(' ') : null,
      ...(staff ? { customer: row.customer.name, notes: row.notes } : {}),
    })),
    delivered: deliveredToday.map((row) => ({
      id: row.id,
      jobNumber: row.jobNumber,
      deliveredAt: row.deliveredAt,
      plate: row.vehicle.plateNumber,
      vehicle: [row.vehicle.make, row.vehicle.model].filter(Boolean).join(' '),
    })),
    team,
  };
}

export type LiveBoard = Awaited<ReturnType<typeof loadLiveBoard>>;
export type LiveJob = LiveBoard['lanes'][number]['jobs'][number];

/** Who is in today and what they have open — the staff board's side panel. */
async function teamToday(organizationId: string, branchId: string | null) {
  const today = parseCalendarDate(localDateString())!;
  const scope = { organizationId, ...(branchId ? { branchId } : {}) };
  const [employees, days, open] = await Promise.all([
    prisma.employee.findMany({
      where: { ...scope, isActive: true },
      select: { id: true, firstName: true, lastName: true, jobTitle: true },
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
      jobTitle: employee.jobTitle,
      in: !!day?.clockInAt && !day.clockOutAt,
      left: !!day?.clockOutAt,
      clockInAt: day?.clockInAt ?? null,
      openTasks: openOf.get(employee.id) ?? 0,
    };
  });
}

/** The staff board, for a signed-in user who may see job cards. */
export async function getLiveBoard(user: AuthenticatedUser) {
  requirePermission(user, 'job_card.view');
  return loadLiveBoard(user.organizationId, { branchId: user.primaryBranchId, audience: 'staff' });
}

// ─── The TV link ────────────────────────────────────────────────────────────

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** The customer-safe board behind a TV link, or null for an unknown or revoked link. */
export async function getDisplayBoard(token: string) {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return null;
  const organization = await prisma.organization.findUnique({
    where: { displayTokenHash: hashToken(token) },
    select: { id: true, isActive: true },
  });
  if (!organization?.isActive) return null;
  return loadLiveBoard(organization.id, { audience: 'public' });
}

export async function getDisplayLinkState(user: AuthenticatedUser) {
  requirePermission(user, 'settings.view');
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: user.organizationId },
    select: { displayTokenHash: true },
  });
  return { active: organization.displayTokenHash !== null };
}

/**
 * Makes a new TV link (replacing any old one, which stops working) and
 * returns its secret once — only its hash is kept.
 */
export async function createDisplayLink(user: AuthenticatedUser) {
  requirePermission(user, 'settings.edit');
  const token = randomBytes(24).toString('base64url');
  await prisma.$transaction(async (tx) => {
    const before = await tx.organization.findUniqueOrThrow({
      where: { id: user.organizationId },
      select: { displayTokenHash: true },
    });
    await tx.organization.update({ where: { id: user.organizationId }, data: { displayTokenHash: hashToken(token) } });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: before.displayTokenHash ? 'organization.display_link_replaced' : 'organization.display_link_created',
      entityType: 'Organization',
      entityId: user.organizationId,
    });
  });
  return { token };
}

export async function revokeDisplayLink(user: AuthenticatedUser) {
  requirePermission(user, 'settings.edit');
  await prisma.$transaction(async (tx) => {
    await tx.organization.update({ where: { id: user.organizationId }, data: { displayTokenHash: null } });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: 'organization.display_link_revoked',
      entityType: 'Organization',
      entityId: user.organizationId,
    });
  });
}
