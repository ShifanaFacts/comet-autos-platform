import type { Prisma } from '@/generated/prisma/client';
import type { JobCardStatus } from '@/generated/prisma/enums';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { DomainError, NotFoundError } from '@/lib/errors';
import {
  JOB_STATUS_LABEL,
  WORKFLOW_STAGES,
  getEffectiveStageStatus,
  type WorkflowStage,
} from '@/lib/workshop/stages';

export { WORKFLOW_STAGES, JOB_STATUS_LABEL, getEffectiveStageStatus };
export type { WorkflowStage };

/**
 * The job card state machine over the frozen JobCardStatus enum.
 *
 * Conceptual workshop stage → enum value:
 *   ARRIVED            → RECEIVED
 *   INSPECTION         → INSPECTING
 *   DIAGNOSIS          → DIAGNOSED
 *   ESTIMATE / WAITING_APPROVAL → ESTIMATE_SENT (draft estimates exist while DIAGNOSED)
 *   APPROVED           → APPROVED
 *   REJECTED           → stays ESTIMATE_SENT; the latest Estimate is REJECTED (revise or cancel)
 *   REPAIR             → IN_PROGRESS
 *   QUALITY_CHECK/READY → COMPLETED
 *   INVOICED           → INVOICED
 *   PAID / DELIVERED   → CLOSED
 * No status outside the enum is ever written.
 */
const ALLOWED_TRANSITIONS: Record<JobCardStatus, JobCardStatus[]> = {
  RECEIVED: ['INSPECTING', 'ON_HOLD', 'CANCELLED'],
  INSPECTING: ['DIAGNOSED', 'ON_HOLD', 'CANCELLED'],
  DIAGNOSED: ['ESTIMATE_SENT', 'ON_HOLD', 'CANCELLED'],
  ESTIMATE_SENT: ['APPROVED', 'ON_HOLD', 'CANCELLED'],
  APPROVED: ['IN_PROGRESS', 'ON_HOLD', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'ON_HOLD', 'CANCELLED'],
  ON_HOLD: ['RECEIVED', 'INSPECTING', 'DIAGNOSED', 'ESTIMATE_SENT', 'APPROVED', 'IN_PROGRESS', 'CANCELLED'],
  COMPLETED: ['INVOICED'],
  INVOICED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

/**
 * Transitions that are the *result* of recording workflow evidence and must
 * never be clicked through manually: a job only enters inspection when an
 * inspection is started, is only diagnosed when a diagnosis is recorded, is
 * only waiting approval when an estimate is sent, and is only approved when
 * an approval is recorded.
 */
const WORKFLOW_OWNED: Partial<Record<JobCardStatus, string>> = {
  INSPECTING: 'Start the inspection to move this job into inspection.',
  DIAGNOSED: 'Record the diagnosis to move this job forward.',
  ESTIMATE_SENT: 'Send an estimate to the customer to move this job forward.',
  APPROVED: 'Record the customer approval to move this job forward.',
};

const EXCEPTION_STATUSES: JobCardStatus[] = ['ON_HOLD', 'CANCELLED'];

export class InvalidJobStatusTransitionError extends DomainError {}

export function getAllowedNextStatuses(status: JobCardStatus): JobCardStatus[] {
  return ALLOWED_TRANSITIONS[status];
}

export function canTransition(from: JobCardStatus, to: JobCardStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** The forward transition a user may apply manually from this status (post-approval stages only). */
export function getManualForwardStatus(status: JobCardStatus): JobCardStatus | null {
  const forward = ALLOWED_TRANSITIONS[status].find((s) => !EXCEPTION_STATUSES.includes(s));
  if (!forward || WORKFLOW_OWNED[forward]) return null;
  return forward;
}

export function getSecondaryNextStatuses(status: JobCardStatus): JobCardStatus[] {
  return ALLOWED_TRANSITIONS[status].filter((s) => EXCEPTION_STATUSES.includes(s));
}

export type TransitionSource = 'manual' | 'workflow';

/**
 * Applies a status change with its history row and audit entry, in the
 * caller's transaction. Locks the job card row first, so two concurrent
 * changes can't both read the same "from" status.
 *
 * `actorUserId` is the user the change is attributed to. For customer
 * decisions made through a secure link it is the staff member who issued
 * that link (JobStatusHistory.changedByUserId is required by the schema);
 * the audit entry's metadata records that the customer made the decision.
 */
export async function applyJobStatusChange(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    jobCardId: string;
    toStatus: JobCardStatus;
    actorUserId: string;
    source: TransitionSource;
    auditActorUserId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<{ fromStatus: JobCardStatus }> {
  await tx.$executeRaw`SELECT id FROM job_cards WHERE id = ${params.jobCardId}::uuid AND organization_id = ${params.organizationId}::uuid FOR UPDATE`;
  const jobCard = await tx.jobCard.findFirst({
    where: { id: params.jobCardId, organizationId: params.organizationId },
    select: { id: true, status: true, branchId: true },
  });
  if (!jobCard) throw new NotFoundError('job card');

  const { toStatus } = params;
  if (!canTransition(jobCard.status, toStatus)) {
    throw new InvalidJobStatusTransitionError(
      `A job that is "${JOB_STATUS_LABEL[jobCard.status]}" can't move to "${JOB_STATUS_LABEL[toStatus]}".`,
    );
  }
  // Resuming from hold is manual but must return to where the job paused.
  if (params.source === 'manual' && jobCard.status !== 'ON_HOLD' && WORKFLOW_OWNED[toStatus]) {
    throw new InvalidJobStatusTransitionError(WORKFLOW_OWNED[toStatus]!);
  }
  if (params.source === 'manual' && jobCard.status === 'ON_HOLD' && toStatus !== 'CANCELLED') {
    const history = await tx.jobStatusHistory.findMany({
      where: { organizationId: params.organizationId, jobCardId: jobCard.id },
      orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
      select: { toStatus: true },
    });
    const resumeTo = getEffectiveStageStatus('ON_HOLD', history);
    if (toStatus !== resumeTo) {
      throw new InvalidJobStatusTransitionError(
        `This job was paused at "${JOB_STATUS_LABEL[resumeTo]}" and can only resume there.`,
      );
    }
  }

  await tx.jobCard.update({
    where: { id: jobCard.id },
    data: { status: toStatus, closedAt: toStatus === 'CLOSED' ? new Date() : undefined },
  });
  await tx.jobStatusHistory.create({
    data: {
      organizationId: params.organizationId,
      jobCardId: jobCard.id,
      fromStatus: jobCard.status,
      toStatus,
      changedByUserId: params.actorUserId,
    },
  });
  await writeAuditLog(tx, {
    organizationId: params.organizationId,
    branchId: jobCard.branchId,
    actorUserId: params.auditActorUserId === undefined ? params.actorUserId : params.auditActorUserId,
    action: 'job_card.status_changed',
    entityType: 'JobCard',
    entityId: jobCard.id,
    beforeData: { status: jobCard.status },
    afterData: { status: toStatus },
    metadata: { source: params.source, ...params.metadata },
  });
  return { fromStatus: jobCard.status };
}

/** Staff-initiated status change (hold, resume, cancel, and post-approval stages). */
export async function transitionJobStatus(
  tx: Prisma.TransactionClient,
  user: AuthenticatedUser,
  jobCardId: string,
  toStatus: JobCardStatus,
): Promise<void> {
  const jobCard = await tx.jobCard.findFirst({
    where: { id: jobCardId, organizationId: user.organizationId },
    select: { branchId: true },
  });
  if (!jobCard) throw new NotFoundError('job card');
  requirePermission(user, toStatus === 'CLOSED' ? 'job_card.close' : 'job_card.edit', {
    branchId: jobCard.branchId,
  });
  await applyJobStatusChange(tx, {
    organizationId: user.organizationId,
    jobCardId,
    toStatus,
    actorUserId: user.id,
    source: 'manual',
  });
}

export async function getResumeStatus(
  tx: Prisma.TransactionClient,
  organizationId: string,
  jobCardId: string,
): Promise<JobCardStatus> {
  const history = await tx.jobStatusHistory.findMany({
    where: { organizationId, jobCardId },
    orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
    select: { toStatus: true },
  });
  return getEffectiveStageStatus('ON_HOLD', history);
}
