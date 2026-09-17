import { prisma } from '@/lib/prisma';
import { DomainError } from '@/lib/errors';
import { compactPlate, phoneCore } from '@/lib/normalize';
import { localDateString } from '@/lib/format';
import { applyEstimateDecision, type EstimateDecision } from '@/lib/workshop/estimates';
import {
  computeAccessProof,
  proofMatches,
  resolveAccessToken,
  type TokenState,
} from '@/lib/customer-access/tokens';

/*
 * Everything the customer-facing quotation page needs, keyed only by the raw
 * token from the link. Nothing here accepts an estimate id, job id or
 * organization id from the browser, so a customer can never reach any
 * resource other than the one their token was issued for.
 */

async function loadOwnerIdentifiers(organizationId: string, estimateId: string) {
  const estimate = await prisma.estimate.findFirst({
    where: { id: estimateId, organizationId },
    select: {
      jobCard: {
        select: {
          vehicle: { select: { plateNumber: true, customer: { select: { phone: true } } } },
        },
      },
    },
  });
  if (!estimate) return null;
  return {
    plateNumber: estimate.jobCard.vehicle.plateNumber,
    phone: estimate.jobCard.vehicle.customer.phone,
  };
}

export type QuoteAccess =
  | { state: 'invalid' }
  | { state: 'expired'; organization: OrganizationBranding }
  | { state: 'needs_verification'; tokenHash: string; organization: OrganizationBranding }
  | { state: 'verified'; tokenHash: string; organization: OrganizationBranding };

export interface OrganizationBranding {
  name: string;
  legalName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  taxNumber: string | null;
}

async function loadBranding(organizationId: string): Promise<OrganizationBranding> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true, legalName: true, address: true, phone: true, email: true, taxNumber: true },
  });
  return org;
}

/** Resolves the link and checks the browser's verification proof (cookie value). */
export async function getQuoteAccess(rawToken: string, proof: string | undefined): Promise<QuoteAccess> {
  const resolved = await resolveAccessToken(rawToken, 'ESTIMATE');
  if (resolved.state === 'invalid' || !resolved.token) return { state: 'invalid' };
  const organization = await loadBranding(resolved.token.organizationId);
  if (resolved.state === 'expired') return { state: 'expired', organization };

  const owner = await loadOwnerIdentifiers(resolved.token.organizationId, resolved.token.resourceId);
  if (!owner) return { state: 'invalid' };
  const expected = computeAccessProof(resolved.token.tokenHash, owner.plateNumber, owner.phone);
  return proofMatches(expected, proof)
    ? { state: 'verified', tokenHash: resolved.token.tokenHash, organization }
    : { state: 'needs_verification', tokenHash: resolved.token.tokenHash, organization };
}

/**
 * Checks the registration + mobile number the customer typed against the
 * vehicle and owner on the estimate. The same generic message is returned
 * for every mismatch so the form can't be used to probe which part was wrong.
 */
export async function verifyQuoteAccess(
  rawToken: string,
  plateNumber: string,
  phone: string,
): Promise<{ ok: true; proof: string; tokenHash: string } | { ok: false; state: TokenState | 'mismatch' }> {
  const resolved = await resolveAccessToken(rawToken, 'ESTIMATE');
  if (resolved.state !== 'valid' || !resolved.token) return { ok: false, state: resolved.state };

  const owner = await loadOwnerIdentifiers(resolved.token.organizationId, resolved.token.resourceId);
  const plateOk = owner !== null && compactPlate(plateNumber).length > 0 && compactPlate(plateNumber) === compactPlate(owner.plateNumber);
  const phoneOk = owner !== null && phoneCore(phone).length >= 7 && phoneCore(phone) === phoneCore(owner.phone);
  if (!owner || !plateOk || !phoneOk) return { ok: false, state: 'mismatch' };

  await prisma.customerAccessToken.update({
    where: { id: resolved.token.id },
    data: { lastAccessedAt: new Date() },
  });
  return {
    ok: true,
    proof: computeAccessProof(resolved.token.tokenHash, owner.plateNumber, owner.phone),
    tokenHash: resolved.token.tokenHash,
  };
}

/** The quotation as the customer sees it. Call only after getQuoteAccess returned "verified". */
export async function loadCustomerQuote(rawToken: string) {
  const resolved = await resolveAccessToken(rawToken, 'ESTIMATE');
  if (resolved.state !== 'valid' || !resolved.token) return null;
  const { organizationId, resourceId } = resolved.token;

  const estimate = await prisma.estimate.findFirst({
    where: { id: resourceId, organizationId },
    select: {
      estimateNumber: true,
      version: true,
      status: true,
      subtotal: true,
      taxAmount: true,
      totalAmount: true,
      validUntil: true,
      sentAt: true,
      items: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          itemType: true,
          description: true,
          quantity: true,
          unitPrice: true,
          lineTotal: true,
          taxRate: true,
          taxAmount: true,
        },
      },
      approvals: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { status: true, approvedAt: true, createdAt: true, notes: true },
      },
      jobCard: {
        select: {
          jobNumber: true,
          customerComplaint: true,
          odometerReading: true,
          vehicle: {
            select: {
              plateNumber: true,
              make: true,
              model: true,
              year: true,
              customer: { select: { name: true } },
            },
          },
          inspections: {
            where: { status: 'COMPLETED' },
            orderBy: { inspectedAt: 'desc' },
            take: 1,
            select: {
              summary: true,
              items: {
                where: { result: { in: ['ATTENTION_NEEDED', 'FAILED'] } },
                orderBy: [{ result: 'desc' }, { createdAt: 'asc' }],
                select: { category: true, description: true, result: true, notes: true },
              },
            },
          },
          diagnoses: {
            orderBy: { diagnosedAt: 'desc' },
            take: 1,
            select: { findings: true, recommendedAction: true },
          },
        },
      },
    },
  });
  if (!estimate) return null;
  const expired =
    estimate.status === 'SENT' &&
    estimate.validUntil !== null &&
    estimate.validUntil.toISOString().slice(0, 10) < localDateString();
  return { ...estimate, expired };
}

/** Records the customer's own decision made through the secure link. */
export async function decideQuoteAsCustomer(
  rawToken: string,
  proof: string | undefined,
  decision: EstimateDecision,
  notes: string | null,
) {
  const access = await getQuoteAccess(rawToken, proof);
  if (access.state !== 'verified') {
    throw new DomainError('Please confirm your vehicle details again before responding.');
  }
  const resolved = await resolveAccessToken(rawToken, 'ESTIMATE');
  if (resolved.state !== 'valid' || !resolved.token) {
    throw new DomainError('This link is no longer valid.');
  }
  const token = resolved.token;
  const trimmedNotes = notes?.trim().slice(0, 2000) || null;

  return prisma.$transaction(async (tx) => {
    // Re-check revocation inside the transaction: a revision may have been created a moment ago.
    const fresh = await resolveAccessToken(rawToken, 'ESTIMATE', tx);
    if (fresh.state !== 'valid') throw new DomainError('This link is no longer valid.');

    const approval = await applyEstimateDecision(tx, {
      organizationId: token.organizationId,
      estimateId: token.resourceId,
      decision,
      // The frozen ApprovalMethod enum has no "online link" value;
      // DIGITAL_SIGNATURE is used for a decision the customer made themselves
      // through the verified secure link. See PROJECT-STATUS.md.
      method: 'DIGITAL_SIGNATURE',
      notes: trimmedNotes,
      // Approval.recordedByUserId is required: attribute it to the staff
      // member who issued the link. The audit entry records that the
      // customer made the decision.
      recordedByUserId: token.createdByUserId,
      auditActorUserId: null,
      decidedBy: 'customer',
      metadata: { customerAccessTokenId: token.id },
    });
    await tx.customerAccessToken.update({ where: { id: token.id }, data: { lastAccessedAt: new Date() } });
    return approval;
  });
}
