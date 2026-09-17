import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import type { ApprovalMethod } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { allocateDocumentNumber } from '@/lib/numbering';
import { DomainError, NotFoundError } from '@/lib/errors';
import { parseInput } from '@/lib/form-data';
import { calculateLine, calculateTotals, DEFAULT_VAT_RATE } from '@/lib/money';
import { endOfLocalDay, localDateString, parseCalendarDate } from '@/lib/format';
import { applyJobStatusChange } from '@/lib/workshop/job-status';
import { issueAccessToken, revokeAccessTokens } from '@/lib/customer-access/tokens';

/** Default quotation validity when a new estimate is created. Editable per estimate. */
export const DEFAULT_QUOTE_VALIDITY_DAYS = 14;

export { ESTIMATE_STATUS_LABEL } from '@/lib/workshop/labels';

async function lockJob(tx: Prisma.TransactionClient, organizationId: string, jobCardId: string) {
  await tx.$executeRaw`SELECT id FROM job_cards WHERE id = ${jobCardId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
}

async function loadEstimate(tx: Prisma.TransactionClient, organizationId: string, estimateId: string) {
  const estimate = await tx.estimate.findFirst({
    where: { id: estimateId, organizationId },
    include: {
      jobCard: { select: { id: true, branchId: true, status: true } },
      items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      _count: { select: { nextVersions: true } },
    },
  });
  if (!estimate) throw new NotFoundError('estimate');
  return estimate;
}

function defaultValidUntil(): Date {
  const today = parseCalendarDate(localDateString())!;
  return new Date(today.getTime() + DEFAULT_QUOTE_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
}

/** Opens version 1 of the job's estimate as a draft. Returns the existing draft if one is already open. */
export async function createEstimate(user: AuthenticatedUser, jobCardId: string) {
  return prisma.$transaction(async (tx) => {
    await lockJob(tx, user.organizationId, jobCardId);
    const jobCard = await tx.jobCard.findFirst({
      where: { id: jobCardId, organizationId: user.organizationId },
      select: { id: true, branchId: true, status: true },
    });
    if (!jobCard) throw new NotFoundError('job card');
    requirePermission(user, 'job_card.edit', { branchId: jobCard.branchId });

    const existing = await tx.estimate.findFirst({
      where: { jobCardId: jobCard.id, organizationId: user.organizationId },
      orderBy: { version: 'desc' },
    });
    if (existing?.status === 'DRAFT') return existing;
    if (existing) throw new DomainError('This job already has an estimate. Revise it instead.');
    if (jobCard.status !== 'DIAGNOSED') {
      throw new DomainError('Record the diagnosis before creating an estimate.');
    }

    const estimateNumber = await allocateDocumentNumber(tx, user.organizationId, jobCard.branchId, 'ESTIMATE');
    const estimate = await tx.estimate.create({
      data: {
        organizationId: user.organizationId,
        jobCardId: jobCard.id,
        estimateNumber,
        version: 1,
        status: 'DRAFT',
        subtotal: '0.00',
        taxAmount: '0.00',
        totalAmount: '0.00',
        preparedByUserId: user.id,
        validUntil: defaultValidUntil(),
      },
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: jobCard.branchId,
      actorUserId: user.id,
      action: 'estimate.created',
      entityType: 'Estimate',
      entityId: estimate.id,
      afterData: { jobCardId: jobCard.id, estimateNumber, version: 1 },
    });
    return estimate;
  });
}

const lineSchema = z.object({
  itemType: z.enum(['LABOUR', 'PART'], { error: 'Choose labour or part.' }),
  description: z
    .string({ error: 'Every line needs a description.' })
    .trim()
    .min(1, 'Every line needs a description.')
    .max(300),
  quantity: z.string().trim().min(1, 'Enter a quantity.'),
  unitPrice: z.string().trim().min(1, 'Enter a price.'),
  taxRate: z.string().trim().optional(),
});

const draftSchema = z.object({
  items: z.array(lineSchema).max(100, 'An estimate can have at most 100 lines.'),
  validUntil: z.string({ error: 'Choose how long the quotation is valid.' }).min(1, 'Choose how long the quotation is valid.'),
});

function priceLines(items: z.infer<typeof lineSchema>[]) {
  return items.map((item, index) => {
    try {
      return {
        ...item,
        amounts: calculateLine({
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRate: item.taxRate || DEFAULT_VAT_RATE,
        }),
      };
    } catch (error) {
      throw new DomainError(
        `Line ${index + 1}: ${error instanceof Error ? error.message : 'invalid amount.'}`,
        `items.${index}`,
      );
    }
  });
}

/** Replaces a draft's lines and recalculates Subtotal / VAT / Total on the server. */
export async function saveEstimateDraft(user: AuthenticatedUser, estimateId: string, rawInput: unknown) {
  const input = parseInput(draftSchema, rawInput);
  const lines = priceLines(input.items);
  const totals = calculateTotals(lines.map((line) => line.amounts));
  const validUntil = parseCalendarDate(input.validUntil);
  if (!validUntil) throw new DomainError('Choose a valid date.', 'validUntil');

  return prisma.$transaction(async (tx) => {
    const estimate = await loadEstimate(tx, user.organizationId, estimateId);
    requirePermission(user, 'job_card.edit', { branchId: estimate.jobCard.branchId });
    await tx.$executeRaw`SELECT id FROM estimates WHERE id = ${estimate.id}::uuid FOR UPDATE`;
    const fresh = await tx.estimate.findUniqueOrThrow({ where: { id: estimate.id }, select: { status: true } });
    if (fresh.status !== 'DRAFT') {
      throw new DomainError('This estimate has already been sent and can no longer be edited. Revise it instead.');
    }

    await tx.estimateItem.deleteMany({ where: { estimateId: estimate.id, organizationId: user.organizationId } });
    for (const line of lines) {
      await tx.estimateItem.create({
        data: {
          organizationId: user.organizationId,
          estimateId: estimate.id,
          itemType: line.itemType,
          description: line.description,
          quantity: line.amounts.quantity,
          unitPrice: line.amounts.unitPrice,
          lineTotal: line.amounts.lineTotal,
          taxRate: line.amounts.taxRate,
          taxAmount: line.amounts.taxAmount,
        },
      });
    }
    return tx.estimate.update({
      where: { id: estimate.id },
      data: { ...totals, validUntil },
    });
  });
}

/**
 * Sends the draft to the customer: locks it, moves the job to "Waiting
 * approval" (first version only — revisions are sent while the job is
 * already waiting), revokes links to every other version of this job's
 * estimate, and issues a fresh secure link. The raw link is returned once
 * and never stored.
 */
export async function sendEstimate(user: AuthenticatedUser, estimateId: string) {
  return prisma.$transaction(async (tx) => {
    const estimate = await loadEstimate(tx, user.organizationId, estimateId);
    requirePermission(user, 'job_card.edit', { branchId: estimate.jobCard.branchId });
    await lockJob(tx, user.organizationId, estimate.jobCardId);
    await tx.$executeRaw`SELECT id FROM estimates WHERE id = ${estimate.id}::uuid FOR UPDATE`;

    const fresh = await tx.estimate.findUniqueOrThrow({ where: { id: estimate.id } });
    if (fresh.status !== 'DRAFT') throw new DomainError('This estimate has already been sent.');
    if (estimate._count.nextVersions > 0) throw new DomainError('A newer version of this estimate exists.');
    if (estimate.items.length === 0) throw new DomainError('Add at least one labour or parts line before sending.');
    if (!fresh.validUntil) throw new DomainError('Choose how long the quotation is valid.', 'validUntil');
    if (fresh.validUntil.toISOString().slice(0, 10) < localDateString()) {
      throw new DomainError('The validity date is in the past.', 'validUntil');
    }

    const jobStatus = (await tx.jobCard.findUniqueOrThrow({ where: { id: estimate.jobCardId }, select: { status: true } }))
      .status;
    if (jobStatus === 'DIAGNOSED') {
      await applyJobStatusChange(tx, {
        organizationId: user.organizationId,
        jobCardId: estimate.jobCardId,
        toStatus: 'ESTIMATE_SENT',
        actorUserId: user.id,
        source: 'workflow',
        metadata: { estimateId: estimate.id },
      });
    } else if (jobStatus !== 'ESTIMATE_SENT') {
      throw new DomainError('The job is not at the estimate stage, so this estimate cannot be sent.');
    }

    const sentAt = new Date();
    await tx.estimate.update({
      where: { id: estimate.id },
      data: { status: 'SENT', sentAt, sentByUserId: user.id },
    });

    const siblings = await tx.estimate.findMany({
      where: { jobCardId: estimate.jobCardId, organizationId: user.organizationId, id: { not: estimate.id } },
      select: { id: true },
    });
    await revokeAccessTokens(tx, user.organizationId, 'ESTIMATE', siblings.map((s) => s.id));
    const { rawToken, tokenId } = await issueAccessToken(tx, {
      organizationId: user.organizationId,
      resourceType: 'ESTIMATE',
      resourceId: estimate.id,
      createdByUserId: user.id,
      expiresAt: endOfLocalDay(fresh.validUntil),
    });

    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: estimate.jobCard.branchId,
      actorUserId: user.id,
      action: 'estimate.sent',
      entityType: 'Estimate',
      entityId: estimate.id,
      beforeData: { status: 'DRAFT' },
      afterData: {
        status: 'SENT',
        version: fresh.version,
        totalAmount: fresh.totalAmount.toString(),
        validUntil: fresh.validUntil.toISOString().slice(0, 10),
      },
      metadata: { customerAccessTokenId: tokenId },
    });
    return { rawToken };
  });
}

/** Issues a replacement secure link for a sent estimate and revokes the old one (e.g. the customer lost the message). */
export async function reissueEstimateLink(user: AuthenticatedUser, estimateId: string) {
  return prisma.$transaction(async (tx) => {
    const estimate = await loadEstimate(tx, user.organizationId, estimateId);
    requirePermission(user, 'job_card.edit', { branchId: estimate.jobCard.branchId });
    if (estimate.status !== 'SENT' || estimate._count.nextVersions > 0 || !estimate.validUntil) {
      throw new DomainError('A new link can only be created for the estimate currently waiting approval.');
    }
    if (estimate.validUntil.toISOString().slice(0, 10) < localDateString()) {
      throw new DomainError('This quotation has expired. Revise it to send a new one.');
    }
    const revoked = await revokeAccessTokens(tx, user.organizationId, 'ESTIMATE', [estimate.id]);
    const { rawToken, tokenId } = await issueAccessToken(tx, {
      organizationId: user.organizationId,
      resourceType: 'ESTIMATE',
      resourceId: estimate.id,
      createdByUserId: user.id,
      expiresAt: endOfLocalDay(estimate.validUntil),
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: estimate.jobCard.branchId,
      actorUserId: user.id,
      action: 'customer_access.link_reissued',
      entityType: 'Estimate',
      entityId: estimate.id,
      metadata: { customerAccessTokenId: tokenId, revokedTokens: revoked },
    });
    return { rawToken };
  });
}

function rootEstimateNumber(estimateNumber: string): string {
  return estimateNumber.replace(/-R\d+$/, '');
}

/**
 * Creates the next version as a new draft, copying the lines. The previous
 * version and its approval history are never modified; its customer link is
 * revoked so an outdated quotation can't be approved.
 */
export async function reviseEstimate(user: AuthenticatedUser, estimateId: string) {
  return prisma.$transaction(async (tx) => {
    const source = await loadEstimate(tx, user.organizationId, estimateId);
    requirePermission(user, 'job_card.edit', { branchId: source.jobCard.branchId });
    await lockJob(tx, user.organizationId, source.jobCardId);

    const newer = await tx.estimate.findFirst({
      where: { previousVersionId: source.id, organizationId: user.organizationId },
    });
    if (newer) {
      if (newer.status === 'DRAFT') return newer;
      throw new DomainError('A newer version of this estimate already exists.');
    }
    if (source.status !== 'SENT' && source.status !== 'REJECTED') {
      throw new DomainError('Only an estimate that is waiting approval or was rejected can be revised.');
    }
    const job = await tx.jobCard.findUniqueOrThrow({ where: { id: source.jobCardId }, select: { status: true } });
    if (job.status !== 'ESTIMATE_SENT') {
      throw new DomainError('The job is no longer at the estimate stage.');
    }

    const version = source.version + 1;
    const revision = await tx.estimate.create({
      data: {
        organizationId: user.organizationId,
        jobCardId: source.jobCardId,
        previousVersionId: source.id,
        estimateNumber: `${rootEstimateNumber(source.estimateNumber)}-R${version}`,
        version,
        status: 'DRAFT',
        subtotal: source.subtotal,
        taxAmount: source.taxAmount,
        totalAmount: source.totalAmount,
        preparedByUserId: user.id,
        validUntil: defaultValidUntil(),
      },
    });
    for (const item of source.items) {
      await tx.estimateItem.create({
        data: {
          organizationId: user.organizationId,
          estimateId: revision.id,
          itemType: item.itemType,
          partId: item.partId,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
          taxRate: item.taxRate,
          taxAmount: item.taxAmount,
        },
      });
    }
    await revokeAccessTokens(tx, user.organizationId, 'ESTIMATE', [source.id]);
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: source.jobCard.branchId,
      actorUserId: user.id,
      action: 'estimate.revised',
      entityType: 'Estimate',
      entityId: revision.id,
      afterData: { version, previousVersionId: source.id, previousStatus: source.status },
    });
    return revision;
  });
}

export type EstimateDecision = 'APPROVED' | 'REJECTED';

/**
 * The single code path for a customer's decision, whether they made it on
 * the secure link or told a staff member in person / by phone.
 *
 * Whole-quotation decisions only in V1: every line gets the same
 * ApprovalItem decision (PARTIALLY_APPROVED is not offered yet).
 */
export async function applyEstimateDecision(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    estimateId: string;
    decision: EstimateDecision;
    method: ApprovalMethod;
    notes: string | null;
    recordedByUserId: string;
    auditActorUserId: string | null;
    decidedBy: 'customer' | 'staff';
    metadata?: Record<string, unknown>;
  },
) {
  await tx.$executeRaw`SELECT id FROM estimates WHERE id = ${params.estimateId}::uuid AND organization_id = ${params.organizationId}::uuid FOR UPDATE`;
  const estimate = await loadEstimate(tx, params.organizationId, params.estimateId);

  if (estimate.status !== 'SENT') {
    throw new DomainError(
      estimate.status === 'APPROVED' || estimate.status === 'REJECTED'
        ? 'A decision has already been recorded for this quotation.'
        : 'This quotation is not waiting for approval.',
    );
  }
  if (estimate._count.nextVersions > 0) {
    throw new DomainError('This quotation has been replaced by a newer version.');
  }
  if (estimate.validUntil && estimate.validUntil.toISOString().slice(0, 10) < localDateString()) {
    throw new DomainError('This quotation has expired.');
  }

  const now = new Date();
  const approval = await tx.approval.create({
    data: {
      organizationId: params.organizationId,
      estimateId: estimate.id,
      status: params.decision,
      approvalMethod: params.method,
      approvedAt: params.decision === 'APPROVED' ? now : null,
      recordedByUserId: params.recordedByUserId,
      notes: params.notes,
    },
  });
  if (estimate.items.length > 0) {
    await tx.approvalItem.createMany({
      data: estimate.items.map((item) => ({
        organizationId: params.organizationId,
        approvalId: approval.id,
        estimateItemId: item.id,
        decision: params.decision,
      })),
    });
  }
  await tx.estimate.update({ where: { id: estimate.id }, data: { status: params.decision } });

  if (params.decision === 'APPROVED') {
    await lockJob(tx, params.organizationId, estimate.jobCardId);
    const job = await tx.jobCard.findUniqueOrThrow({ where: { id: estimate.jobCardId }, select: { status: true } });
    if (job.status !== 'ESTIMATE_SENT') {
      throw new DomainError('The job is not waiting for approval (it may be on hold). Ask the workshop to resume it.');
    }
    await applyJobStatusChange(tx, {
      organizationId: params.organizationId,
      jobCardId: estimate.jobCardId,
      toStatus: 'APPROVED',
      actorUserId: params.recordedByUserId,
      auditActorUserId: params.auditActorUserId,
      source: 'workflow',
      metadata: { estimateId: estimate.id, approvalId: approval.id, decidedBy: params.decidedBy },
    });
  }

  await writeAuditLog(tx, {
    organizationId: params.organizationId,
    branchId: estimate.jobCard.branchId,
    actorUserId: params.auditActorUserId,
    action: params.decision === 'APPROVED' ? 'approval.approved' : 'approval.rejected',
    entityType: 'Approval',
    entityId: approval.id,
    afterData: {
      estimateId: estimate.id,
      estimateNumber: estimate.estimateNumber,
      version: estimate.version,
      status: params.decision,
      method: params.method,
      totalAmount: estimate.totalAmount.toString(),
      notes: params.notes,
    },
    metadata: { decidedBy: params.decidedBy, ...params.metadata },
  });
  return approval;
}

const staffDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED'], { error: 'Choose approved or rejected.' }),
  method: z.enum(['IN_PERSON', 'PHONE', 'EMAIL', 'SMS'], { error: 'Choose how the customer told you.' }),
  notes: z.string().trim().max(2000).optional(),
});

/** A staff member records the customer's decision given in person, by phone, email or SMS. */
export async function recordCustomerDecision(user: AuthenticatedUser, estimateId: string, rawInput: unknown) {
  const input = parseInput(staffDecisionSchema, rawInput);
  return prisma.$transaction(async (tx) => {
    const estimate = await loadEstimate(tx, user.organizationId, estimateId);
    requirePermission(user, 'job_card.edit', { branchId: estimate.jobCard.branchId });
    return applyEstimateDecision(tx, {
      organizationId: user.organizationId,
      estimateId: estimate.id,
      decision: input.decision,
      method: input.method,
      notes: input.notes || null,
      recordedByUserId: user.id,
      auditActorUserId: user.id,
      decidedBy: 'staff',
    });
  });
}
