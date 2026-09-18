import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { DomainError, NotFoundError } from '@/lib/errors';
import { parseInput } from '@/lib/form-data';
import { emptyToNull } from '@/lib/normalize';
import { applyJobStatusChange, normalizeStatus } from '@/lib/workshop/job-status';
import { getIncompleteApprovedLines } from '@/lib/workshop/repair';

const qualityCheckSchema = z
  .object({
    employeeId: z.uuid('Choose who checked the vehicle.'),
    result: z.enum(['PASSED', 'FAILED'], { error: 'Choose pass or fail.' }),
    notes: z.string().trim().max(4000).optional(),
    correctionsRequired: z.string().trim().max(4000).optional(),
  })
  .refine((input) => input.result === 'PASSED' || (input.correctionsRequired ?? '').length > 0, {
    message: 'Describe what has to be corrected.',
    path: ['correctionsRequired'],
  });

/**
 * Records a quality check and moves the job on:
 *
 *   REPAIR → QUALITY_CHECK → READY   (passed — only when every approved line is complete)
 *   REPAIR → QUALITY_CHECK → REPAIR  (failed: back to the technician)
 *
 * Both steps are written to the job's status history, and every check is
 * kept as its own QualityCheck row — a failed check is never overwritten by
 * the re-check that follows it.
 */
export async function recordQualityCheck(user: AuthenticatedUser, jobCardId: string, rawInput: unknown) {
  const input = parseInput(qualityCheckSchema, rawInput);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM job_cards WHERE id = ${jobCardId}::uuid AND organization_id = ${user.organizationId}::uuid FOR UPDATE`;
    const jobCard = await tx.jobCard.findFirst({
      where: { id: jobCardId, organizationId: user.organizationId },
      select: { id: true, branchId: true, status: true },
    });
    if (!jobCard) throw new NotFoundError('job card');
    requirePermission(user, 'job_card.edit', { branchId: jobCard.branchId });

    const status = normalizeStatus(jobCard.status);
    if (status !== 'REPAIR' && status !== 'QUALITY_CHECK') {
      throw new DomainError('A quality check can only be done after the repair.');
    }

    const [parts, labour, waitingAdditional] = await Promise.all([
      tx.partUsage.count({ where: { organizationId: user.organizationId, jobCardId: jobCard.id } }),
      tx.labour.count({ where: { organizationId: user.organizationId, jobCardId: jobCard.id } }),
      tx.estimate.count({
        where: { organizationId: user.organizationId, jobCardId: jobCard.id, kind: 'ADDITIONAL', status: 'SENT' },
      }),
    ]);
    if (parts + labour === 0) {
      throw new DomainError('Record the parts and labour used before the quality check.');
    }
    if (waitingAdditional > 0) {
      throw new DomainError('Additional work is waiting for customer approval. Wait for the decision before the quality check.');
    }
    // All approved work must be completed before the job can pass. A failed
    // check is still allowed at any point: it sends the job back to repair.
    if (input.result === 'PASSED') {
      const incomplete = await getIncompleteApprovedLines(tx, user.organizationId, jobCard.id);
      if (incomplete.length > 0) {
        throw new DomainError(
          `The job can't pass while approved work is incomplete: ${incomplete.map((line) => line.description).join(', ')}.`,
        );
      }
    }

    const employee = await tx.employee.findFirst({
      where: { id: input.employeeId, organizationId: user.organizationId, isActive: true },
      select: { id: true },
    });
    if (!employee) throw new DomainError('Choose who checked the vehicle.', 'employeeId');

    if (status === 'REPAIR') {
      await applyJobStatusChange(tx, {
        organizationId: user.organizationId,
        jobCardId: jobCard.id,
        toStatus: 'QUALITY_CHECK',
        actor: { userId: user.id },
        source: 'workflow',
      });
    }

    const check = await tx.qualityCheck.create({
      data: {
        organizationId: user.organizationId,
        jobCardId: jobCard.id,
        checkedByEmployeeId: employee.id,
        recordedByUserId: user.id,
        status: input.result,
        notes: emptyToNull(input.notes),
        correctionsRequired: input.result === 'FAILED' ? emptyToNull(input.correctionsRequired) : null,
      },
    });

    await applyJobStatusChange(tx, {
      organizationId: user.organizationId,
      jobCardId: jobCard.id,
      toStatus: input.result === 'PASSED' ? 'READY' : 'REPAIR',
      actor: { userId: user.id },
      source: 'workflow',
      metadata: { qualityCheckId: check.id },
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: jobCard.branchId,
      actorUserId: user.id,
      action: input.result === 'PASSED' ? 'quality_check.passed' : 'quality_check.failed',
      entityType: 'QualityCheck',
      entityId: check.id,
      afterData: {
        jobCardId: jobCard.id,
        status: input.result,
        checkedByEmployeeId: employee.id,
        correctionsRequired: check.correctionsRequired,
      },
    });
    return check;
  });
}
