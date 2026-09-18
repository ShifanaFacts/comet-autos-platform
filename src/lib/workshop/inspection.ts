import { z } from 'zod';
import type { InspectionItemResult } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { DomainError, NotFoundError } from '@/lib/errors';
import { parseInput } from '@/lib/form-data';
import { emptyToNull } from '@/lib/normalize';
import { applyJobStatusChange, normalizeStatus } from '@/lib/workshop/job-status';

/**
 * The standard walk-around checklist a technician works through. Items are
 * stored as InspectionItem rows only once a result is recorded, so
 * "NOT CHECKED" is simply the absence of a row — the frozen
 * InspectionItemResult enum has OK / ATTENTION_NEEDED / FAILED only.
 */
export const INSPECTION_CHECKLIST: { category: string; items: string[] }[] = [
  { category: 'Exterior', items: ['Body and paint', 'Windscreen and glass', 'Lights and indicators', 'Wipers'] },
  { category: 'Tyres and brakes', items: ['Tyre tread and condition', 'Tyre pressure', 'Brake pads and discs', 'Brake fluid'] },
  { category: 'Under the bonnet', items: ['Engine oil', 'Coolant', 'Battery', 'Drive belts', 'Hoses and leaks'] },
  { category: 'Underbody', items: ['Suspension and steering', 'Exhaust system', 'CV joints and boots'] },
  { category: 'Interior', items: ['Air conditioning', 'Dashboard warning lights', 'Horn', 'Seat belts'] },
  { category: 'Road test', items: ['Engine performance', 'Transmission and gear change', 'Noises and vibration'] },
];

export type InspectionResultChoice = InspectionItemResult | 'NOT_CHECKED';

export const INSPECTION_RESULT_LABEL: Record<InspectionResultChoice, string> = {
  OK: 'Pass',
  ATTENTION_NEEDED: 'Attention',
  FAILED: 'Fail',
  NOT_CHECKED: 'Not checked',
};

async function loadJobForWork(user: AuthenticatedUser, jobCardId: string) {
  const jobCard = await prisma.jobCard.findFirst({
    where: { id: jobCardId, organizationId: user.organizationId },
    select: { id: true, branchId: true, status: true },
  });
  if (!jobCard) throw new NotFoundError('job card');
  requirePermission(user, 'job_card.edit', { branchId: jobCard.branchId });
  return jobCard;
}

/** Opens the inspection and moves the job from Arrived into Inspection. */
export async function startInspection(user: AuthenticatedUser, jobCardId: string, employeeId: string) {
  const jobCard = await loadJobForWork(user, jobCardId);
  if (normalizeStatus(jobCard.status) !== 'ARRIVED') {
    throw new DomainError('An inspection can only be started when the vehicle has just arrived.');
  }

  return prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findFirst({
      where: { id: employeeId, organizationId: user.organizationId, isActive: true },
      select: { id: true },
    });
    if (!employee) throw new DomainError('Choose who is inspecting the vehicle.', 'employeeId');

    await applyJobStatusChange(tx, {
      organizationId: user.organizationId,
      jobCardId: jobCard.id,
      toStatus: 'INSPECTION',
      actor: { userId: user.id },
      source: 'workflow',
    });
    const inspection = await tx.inspection.create({
      data: {
        organizationId: user.organizationId,
        jobCardId: jobCard.id,
        inspectedByEmployeeId: employee.id,
        status: 'IN_PROGRESS',
      },
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: jobCard.branchId,
      actorUserId: user.id,
      action: 'inspection.started',
      entityType: 'Inspection',
      entityId: inspection.id,
      afterData: { jobCardId: jobCard.id, inspectedByEmployeeId: employee.id },
    });
    return inspection;
  });
}

const itemSchema = z
  .object({
    category: z.string().trim().max(100).optional(),
    description: z.string().trim().min(1, 'Every checkpoint needs a name.').max(200),
    result: z.enum(['OK', 'ATTENTION_NEEDED', 'FAILED', 'NOT_CHECKED']),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine(
    (item) => item.result === 'OK' || item.result === 'NOT_CHECKED' || (item.notes ?? '').length > 0,
    { message: 'Describe what you found for every item marked Attention or Fail.', path: ['notes'] },
  );

const saveSchema = z.object({
  items: z.array(itemSchema).max(200),
  summary: z.string().trim().max(4000).optional(),
});

async function loadOpenInspection(user: AuthenticatedUser, inspectionId: string) {
  const inspection = await prisma.inspection.findFirst({
    where: { id: inspectionId, organizationId: user.organizationId },
    include: { jobCard: { select: { id: true, branchId: true, status: true } } },
  });
  if (!inspection) throw new NotFoundError('inspection');
  requirePermission(user, 'job_card.edit', { branchId: inspection.jobCard.branchId });
  if (inspection.status !== 'IN_PROGRESS') {
    throw new DomainError('This inspection is already complete and can no longer be changed.');
  }
  if (normalizeStatus(inspection.jobCard.status) !== 'INSPECTION') {
    throw new DomainError('This job is not in inspection right now.');
  }
  return inspection;
}

/**
 * Saves the checklist. Recorded items replace the previous set (an item
 * switched back to "Not checked" is removed), so the stored rows always
 * mirror what the technician sees on screen.
 */
export async function saveInspection(
  user: AuthenticatedUser,
  inspectionId: string,
  rawInput: unknown,
  options: { complete: boolean },
) {
  const inspection = await loadOpenInspection(user, inspectionId);
  const input = parseInput(saveSchema, rawInput);
  const recorded = input.items.filter((item) => item.result !== 'NOT_CHECKED');

  if (options.complete && recorded.length === 0) {
    throw new DomainError('Record at least one checkpoint before completing the inspection.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM inspections WHERE id = ${inspection.id}::uuid FOR UPDATE`;
    const fresh = await tx.inspection.findUniqueOrThrow({ where: { id: inspection.id }, select: { status: true } });
    if (fresh.status !== 'IN_PROGRESS') {
      throw new DomainError('This inspection was completed by someone else.');
    }

    await tx.inspectionItem.deleteMany({ where: { inspectionId: inspection.id, organizationId: user.organizationId } });
    if (recorded.length > 0) {
      await tx.inspectionItem.createMany({
        data: recorded.map((item) => ({
          organizationId: user.organizationId,
          inspectionId: inspection.id,
          category: emptyToNull(item.category),
          description: item.description,
          result: item.result as InspectionItemResult,
          notes: emptyToNull(item.notes),
        })),
      });
    }
    await tx.inspection.update({
      where: { id: inspection.id },
      data: {
        summary: emptyToNull(input.summary),
        ...(options.complete ? { status: 'COMPLETED', inspectedAt: new Date() } : {}),
      },
    });

    if (options.complete) {
      const counts = {
        ok: recorded.filter((i) => i.result === 'OK').length,
        attention: recorded.filter((i) => i.result === 'ATTENTION_NEEDED').length,
        failed: recorded.filter((i) => i.result === 'FAILED').length,
      };
      await writeAuditLog(tx, {
        organizationId: user.organizationId,
        branchId: inspection.jobCard.branchId,
        actorUserId: user.id,
        action: 'inspection.completed',
        entityType: 'Inspection',
        entityId: inspection.id,
        afterData: { status: 'COMPLETED', ...counts },
      });
    }
  });
}
