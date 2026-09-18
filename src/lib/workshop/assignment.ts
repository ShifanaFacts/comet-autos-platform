import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { DomainError, NotFoundError } from '@/lib/errors';

export function employeeName(employee: { firstName: string; lastName: string }): string {
  return `${employee.firstName} ${employee.lastName}`.trim();
}

/** Active staff who can be assigned to, inspect, or diagnose a job. */
export async function listWorkshopEmployees(user: AuthenticatedUser) {
  return prisma.employee.findMany({
    where: { organizationId: user.organizationId, isActive: true, terminationDate: null },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    select: { id: true, firstName: true, lastName: true, jobTitle: true, userId: true },
  });
}

/**
 * Sets the job's PRIMARY technician. The previous primary assignment is
 * closed (unassignedAt), never edited or deleted — the database's partial
 * unique index guarantees only one active PRIMARY per job.
 */
export async function assignPrimaryTechnician(
  user: AuthenticatedUser,
  jobCardId: string,
  employeeId: string,
) {
  return prisma.$transaction(async (tx) => {
    const jobCard = await tx.jobCard.findFirst({
      where: { id: jobCardId, organizationId: user.organizationId },
      select: { id: true, branchId: true, status: true },
    });
    if (!jobCard) throw new NotFoundError('job card');
    requirePermission(user, 'job_card.assign', { branchId: jobCard.branchId });
    if (jobCard.status === 'CLOSED' || jobCard.status === 'CANCELLED') {
      throw new DomainError('This job is finished — technicians can no longer be changed.');
    }

    const employee = await tx.employee.findFirst({
      where: { id: employeeId, organizationId: user.organizationId, isActive: true },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!employee) throw new DomainError('Choose an active technician.', 'employeeId');

    await tx.$executeRaw`SELECT id FROM job_cards WHERE id = ${jobCard.id}::uuid FOR UPDATE`;
    const current = await tx.jobAssignment.findFirst({
      where: { jobCardId: jobCard.id, assignmentRole: 'PRIMARY', unassignedAt: null },
      select: { id: true, employeeId: true },
    });
    if (current?.employeeId === employee.id) return;

    if (current) {
      await tx.jobAssignment.update({ where: { id: current.id }, data: { unassignedAt: new Date() } });
    }
    await tx.jobAssignment.create({
      data: {
        organizationId: user.organizationId,
        jobCardId: jobCard.id,
        employeeId: employee.id,
        assignedByUserId: user.id,
        assignmentRole: 'PRIMARY',
      },
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: jobCard.branchId,
      actorUserId: user.id,
      action: 'job_card.technician_assigned',
      entityType: 'JobCard',
      entityId: jobCard.id,
      beforeData: { employeeId: current?.employeeId ?? null },
      afterData: { employeeId: employee.id, name: employeeName(employee) },
    });
  });
}
