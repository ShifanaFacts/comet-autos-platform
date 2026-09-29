import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { allocateDocumentNumber } from '@/lib/numbering';
import { DomainError, NotFoundError } from '@/lib/errors';
import { parseInput } from '@/lib/form-data';
import { claimRequestKey, settleRequestKey } from '@/lib/request-keys';
import { localDateString, parseCalendarDate } from '@/lib/format';
import { DEFAULT_QUOTE_VALIDITY_DAYS } from '@/lib/workshop/estimates';

/*
 * The quotation actions that sit beside pricing, sending and revising:
 *
 *   DUPLICATE  — a fresh first draft with the same customer, vehicle, lines
 *                and discounts, under a new number. Works from any quotation,
 *                including an approved one: that is how an approved quote is
 *                "edited" without rewriting what the customer agreed to.
 *   CHANGE WHO — the customer and vehicle on a first draft that never left
 *                the workshop. Once sent, the document is part of the record;
 *                a job card's quotation belongs to the job's own customer.
 *
 * Editing a sent or rejected quotation is revising it (reviseEstimate), which
 * keeps every earlier version and its decision exactly as they were.
 */

const idSchema = z.object({ requestKey: z.string().optional() });

const partySchema = z.object({
  customerId: z.string({ error: 'Choose the customer.' }).trim().min(1, 'Choose the customer.'),
  vehicleId: z.string().trim().optional(),
});

function validUntil(): Date {
  const today = parseCalendarDate(localDateString())!;
  return new Date(today.getTime() + DEFAULT_QUOTE_VALIDITY_DAYS * 86_400_000);
}

/** The vehicle to keep: only if it is still active and still this customer's. */
async function checkedVehicle(
  tx: Prisma.TransactionClient,
  organizationId: string,
  customerId: string,
  vehicleId: string | null | undefined,
  strict: boolean,
) {
  if (!vehicleId) return null;
  const vehicle = await tx.vehicle.findFirst({
    where: { id: vehicleId, organizationId, isActive: true },
    select: { id: true, customerId: true },
  });
  if (vehicle && vehicle.customerId === customerId) return vehicle.id;
  if (!strict) return null;
  if (!vehicle) throw new DomainError('That vehicle was not found.', 'vehicleId');
  throw new DomainError('That vehicle belongs to a different customer.', 'vehicleId');
}

/**
 * Copies a quotation into a new first draft. The copy stands on its own —
 * never on a job card — and is filed under the user's branch.
 */
export async function duplicateQuotation(
  user: AuthenticatedUser,
  estimateId: string,
  rawInput: unknown = {},
) {
  parseInput(idSchema, rawInput);

  return prisma.$transaction(async (tx) => {
    const source = await tx.estimate.findFirst({
      where: { id: estimateId, organizationId: user.organizationId },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!source) throw new NotFoundError('quotation');
    requirePermission(user, 'job_card.view', { branchId: source.branchId });
    const branchId = user.primaryBranchId ?? source.branchId;
    requirePermission(user, 'job_card.edit', { branchId });
    await claimRequestKey(tx, user, rawInput, 'quotation.duplicate');

    const customer = await tx.customer.findFirst({
      where: { id: source.customerId, organizationId: user.organizationId, isActive: true },
      select: { id: true },
    });
    if (!customer) {
      throw new DomainError(
        'This customer is archived. Restore them before copying the quotation.',
      );
    }
    const vehicleId = await checkedVehicle(
      tx,
      user.organizationId,
      customer.id,
      source.vehicleId,
      false,
    );

    const estimateNumber = await allocateDocumentNumber(
      tx,
      user.organizationId,
      branchId,
      'ESTIMATE',
    );
    const copy = await tx.estimate.create({
      data: {
        organizationId: user.organizationId,
        branchId,
        customerId: customer.id,
        vehicleId,
        estimateNumber,
        version: 1,
        status: 'DRAFT',
        notes: source.notes,
        discountType: source.discountType,
        discountValue: source.discountValue,
        discountAmount: source.discountAmount,
        subtotal: source.subtotal,
        taxAmount: source.taxAmount,
        totalAmount: source.totalAmount,
        preparedByUserId: user.id,
        validUntil: validUntil(),
      },
    });
    // Every priced field of every line, whatever the line carries; only the
    // identity and ownership columns are the copy's own.
    const own = new Set(['id', 'estimateId', 'organizationId', 'createdAt', 'updatedAt']);
    for (const item of source.items) {
      const line = Object.fromEntries(
        Object.entries(item).filter(([key]) => !own.has(key)),
      ) as Omit<typeof item, 'id' | 'estimateId' | 'organizationId' | 'createdAt' | 'updatedAt'>;
      await tx.estimateItem.create({
        data: { ...line, organizationId: user.organizationId, estimateId: copy.id },
      });
    }
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId,
      actorUserId: user.id,
      action: 'estimate.duplicated',
      entityType: 'Estimate',
      entityId: copy.id,
      afterData: {
        estimateNumber,
        copiedFrom: source.estimateNumber,
        copiedFromId: source.id,
        lines: source.items.length,
        vehicleKept: vehicleId !== null || source.vehicleId === null,
      },
    });
    await settleRequestKey(tx, user, rawInput, copy.id);
    return copy;
  });
}

/** Why the customer and vehicle can't be changed, or null when they can. */
export function partyChangeBlocker(estimate: {
  status: string;
  jobCardId: string | null;
  previousVersionId: string | null;
  nextVersions: number;
}): string | null {
  if (estimate.status !== 'DRAFT') {
    return 'Only a draft can change customer or vehicle — copy this quotation instead.';
  }
  if (estimate.jobCardId) return "A job card's quotation is for the job card's own customer.";
  if (estimate.previousVersionId || estimate.nextVersions > 0) {
    return 'A revision stays with the customer it was first quoted to — copy it instead.';
  }
  return null;
}

/** Points a first draft at a different customer and/or vehicle. */
export async function changeQuotationParty(
  user: AuthenticatedUser,
  estimateId: string,
  rawInput: unknown,
) {
  const input = parseInput(partySchema, rawInput);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM estimates WHERE id = ${estimateId}::uuid AND organization_id = ${user.organizationId}::uuid FOR UPDATE`;
    const estimate = await tx.estimate.findFirst({
      where: { id: estimateId, organizationId: user.organizationId },
      include: { _count: { select: { nextVersions: true } } },
    });
    if (!estimate) throw new NotFoundError('quotation');
    requirePermission(user, 'job_card.edit', { branchId: estimate.branchId });
    const blocker = partyChangeBlocker({ ...estimate, nextVersions: estimate._count.nextVersions });
    if (blocker) throw new DomainError(blocker);

    const customer = await tx.customer.findFirst({
      where: { id: input.customerId, organizationId: user.organizationId, isActive: true },
      select: { id: true },
    });
    if (!customer)
      throw new DomainError('Choose the customer this quotation is for.', 'customerId');
    const vehicleId = await checkedVehicle(
      tx,
      user.organizationId,
      customer.id,
      input.vehicleId,
      true,
    );

    const updated = await tx.estimate.update({
      where: { id: estimate.id },
      data: { customerId: customer.id, vehicleId },
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: estimate.branchId,
      actorUserId: user.id,
      action: 'estimate.party_changed',
      entityType: 'Estimate',
      entityId: estimate.id,
      beforeData: { customerId: estimate.customerId, vehicleId: estimate.vehicleId },
      afterData: { customerId: customer.id, vehicleId },
    });
    return updated;
  });
}
