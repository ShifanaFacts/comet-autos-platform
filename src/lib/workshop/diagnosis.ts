import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { DomainError, NotFoundError } from '@/lib/errors';
import { parseInput } from '@/lib/form-data';
import { applyJobStatusChange, normalizeStatus } from '@/lib/workshop/job-status';

export const diagnosisSchema = z.object({
  employeeId: z.uuid('Choose who made the diagnosis.'),
  findings: z
    .string({ error: 'Describe the diagnosis.' })
    .trim()
    .min(3, 'Describe the diagnosis.')
    .max(4000),
  recommendedAction: z
    .string({ error: 'Describe the recommended work.' })
    .trim()
    .min(3, 'Describe the recommended work.')
    .max(4000),
});

/**
 * Records the diagnosis (Diagnosis.findings) and recommendation
 * (Diagnosis.recommendedAction), linked to the completed inspection whose
 * findings it is based on.
 *
 * - Job in Inspection with a completed inspection → creates the diagnosis
 *   and moves the job to Diagnosed.
 * - Job Diagnosed, or with an estimate still in draft → corrects the latest
 *   diagnosis in place.
 * - Once an estimate has been sent the diagnosis is locked: the quotation
 *   the customer saw is based on it.
 */
export async function saveDiagnosis(user: AuthenticatedUser, jobCardId: string, rawInput: unknown) {
  const input = parseInput(diagnosisSchema, rawInput);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM job_cards WHERE id = ${jobCardId}::uuid AND organization_id = ${user.organizationId}::uuid FOR UPDATE`;
    const jobCard = await tx.jobCard.findFirst({
      where: { id: jobCardId, organizationId: user.organizationId },
      select: { id: true, branchId: true, status: true },
    });
    if (!jobCard) throw new NotFoundError('job card');
    requirePermission(user, 'job_card.edit', { branchId: jobCard.branchId });

    const employee = await tx.employee.findFirst({
      where: { id: input.employeeId, organizationId: user.organizationId, isActive: true },
      select: { id: true },
    });
    if (!employee) throw new DomainError('Choose who made the diagnosis.', 'employeeId');
    const status = normalizeStatus(jobCard.status);

    if (status === 'INSPECTION') {
      const inspection = await tx.inspection.findFirst({
        where: { jobCardId: jobCard.id, organizationId: user.organizationId, status: 'COMPLETED' },
        orderBy: { inspectedAt: 'desc' },
        select: { id: true },
      });
      if (!inspection) {
        throw new DomainError('Complete the inspection before recording the diagnosis.');
      }
      await applyJobStatusChange(tx, {
        organizationId: user.organizationId,
        jobCardId: jobCard.id,
        toStatus: 'DIAGNOSIS',
        actor: { userId: user.id },
        source: 'workflow',
      });
      const diagnosis = await tx.diagnosis.create({
        data: {
          organizationId: user.organizationId,
          jobCardId: jobCard.id,
          inspectionId: inspection.id,
          diagnosedByEmployeeId: employee.id,
          findings: input.findings,
          recommendedAction: input.recommendedAction,
        },
      });
      await writeAuditLog(tx, {
        organizationId: user.organizationId,
        branchId: jobCard.branchId,
        actorUserId: user.id,
        action: 'diagnosis.created',
        entityType: 'Diagnosis',
        entityId: diagnosis.id,
        afterData: { jobCardId: jobCard.id, ...input },
      });
      return diagnosis;
    }

    if (status === 'DIAGNOSIS' || status === 'ESTIMATE') {
      const sent = await tx.estimate.findFirst({
        where: { jobCardId: jobCard.id, organizationId: user.organizationId, status: { not: 'DRAFT' } },
        select: { id: true },
      });
      const latest = await tx.diagnosis.findFirst({
        where: { jobCardId: jobCard.id, organizationId: user.organizationId },
        orderBy: { diagnosedAt: 'desc' },
      });
      if (sent || !latest) throw new DomainError('The diagnosis can no longer be changed.');
      const diagnosis = await tx.diagnosis.update({
        where: { id: latest.id },
        data: {
          diagnosedByEmployeeId: employee.id,
          findings: input.findings,
          recommendedAction: input.recommendedAction,
        },
      });
      await writeAuditLog(tx, {
        organizationId: user.organizationId,
        branchId: jobCard.branchId,
        actorUserId: user.id,
        action: 'diagnosis.updated',
        entityType: 'Diagnosis',
        entityId: diagnosis.id,
        beforeData: { findings: latest.findings, recommendedAction: latest.recommendedAction },
        afterData: input,
      });
      return diagnosis;
    }

    if (status === 'ARRIVED') {
      throw new DomainError('Inspect the vehicle before recording a diagnosis.');
    }
    throw new DomainError('The diagnosis can no longer be changed at this stage of the job.');
  });
}
