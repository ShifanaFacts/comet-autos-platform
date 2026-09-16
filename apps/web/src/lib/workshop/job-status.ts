import type { Prisma } from '@/generated/prisma/client';
import type { JobCardStatus } from '@/generated/prisma/enums';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';

// The V1 build instruction describes a finer-grained pipeline (BOOKED →
// ARRIVED → INSPECTION → DIAGNOSIS → ESTIMATE → WAITING_APPROVAL →
// APPROVED → WAITING_PARTS → IN_REPAIR → QUALITY_CHECK → READY →
// DELIVERED → CLOSED) than the frozen JobCardStatus enum actually has.
// Per the schema's frozen-foundation rule, this phase does not add new enum
// values — it maps the conceptual pipeline onto the 11 states that exist:
// WAITING_APPROVAL folds into ESTIMATE_SENT; WAITING_PARTS/IN_REPAIR fold
// into IN_PROGRESS (with ON_HOLD as the generic "blocked" state); QUALITY_
// CHECK/READY/DELIVERED fold into COMPLETED → INVOICED → CLOSED. A future
// phase can revisit splitting these out as a real (additive) schema change
// if the workshop finds this too coarse in practice.
const ALLOWED_TRANSITIONS: Record<JobCardStatus, JobCardStatus[]> = {
  RECEIVED: ['INSPECTING', 'CANCELLED'],
  INSPECTING: ['DIAGNOSED', 'ON_HOLD', 'CANCELLED'],
  DIAGNOSED: ['ESTIMATE_SENT', 'ON_HOLD', 'CANCELLED'],
  ESTIMATE_SENT: ['APPROVED', 'ON_HOLD', 'CANCELLED'],
  APPROVED: ['IN_PROGRESS', 'ON_HOLD', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'ON_HOLD', 'CANCELLED'],
  ON_HOLD: ['INSPECTING', 'DIAGNOSED', 'ESTIMATE_SENT', 'APPROVED', 'IN_PROGRESS', 'CANCELLED'],
  COMPLETED: ['INVOICED'],
  INVOICED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

export class InvalidJobStatusTransitionError extends Error {}

export function getAllowedNextStatuses(status: JobCardStatus): JobCardStatus[] {
  return ALLOWED_TRANSITIONS[status];
}

export async function transitionJobStatus(
  tx: Prisma.TransactionClient,
  user: AuthenticatedUser,
  jobCardId: string,
  toStatus: JobCardStatus,
): Promise<void> {
  requirePermission(user, 'job_card.edit');

  const jobCard = await tx.jobCard.findFirstOrThrow({
    where: { id: jobCardId, organizationId: user.organizationId },
    select: { id: true, status: true, branchId: true },
  });

  const allowed = ALLOWED_TRANSITIONS[jobCard.status];
  if (!allowed.includes(toStatus)) {
    throw new InvalidJobStatusTransitionError(
      `Cannot move job card from ${jobCard.status} to ${toStatus}.`,
    );
  }

  await tx.jobCard.update({
    where: { id: jobCardId },
    data: { status: toStatus, closedAt: toStatus === 'CLOSED' ? new Date() : undefined },
  });

  await tx.jobStatusHistory.create({
    data: {
      organizationId: user.organizationId,
      jobCardId,
      fromStatus: jobCard.status,
      toStatus,
      changedByUserId: user.id,
    },
  });

  await writeAuditLog(tx, {
    organizationId: user.organizationId,
    branchId: jobCard.branchId,
    actorUserId: user.id,
    action: 'job_card.status_changed',
    entityType: 'JobCard',
    entityId: jobCardId,
    beforeData: { status: jobCard.status },
    afterData: { status: toStatus },
  });
}
