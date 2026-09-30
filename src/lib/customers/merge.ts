import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { DomainError, NotFoundError } from '@/lib/errors';
import { parseInput } from '@/lib/form-data';
import { claimRequestKey, settleRequestKey } from '@/lib/request-keys';

/*
 * Merging a duplicate customer into the one to keep.
 *
 * The same person entered twice — once with a mobile, once with a landline —
 * splits their history, their statement and what they owe across two
 * records. Merging moves EVERYTHING the duplicate owns onto the customer
 * kept, then archives the duplicate:
 *
 *   vehicles · appointments · job cards · quotations and their approvals ·
 *   invoices (with their receipts and opening balances) · credit notes ·
 *   signatures · status history · documents filed against the customer
 *
 * The books need no entry: a customer's balance is read from their
 * invoices, receipts and credit notes, so moving those moves the balance —
 * the kept customer's statement and ageing simply include them.
 *
 * What is NOT changed: the customer name, TRN and address printed on each
 * issued invoice and credit note. Those are copies taken when the document
 * was issued — a legal record of what the customer received — and stay as
 * they were.
 *
 * Contact details the kept customer lacks (email, address, TRN, code) are
 * taken from the duplicate; nothing the kept customer already has is
 * overwritten. The duplicate's own details stay on its archived record and
 * in the audit log. A merge is not undone automatically: it is a deliberate
 * act, recorded on both customers.
 */

const mergeSchema = z.object({
  targetId: z.uuid({ error: 'Choose the customer to keep.' }),
  reason: z.string().trim().max(500).optional(),
  requestKey: z.string().optional(),
});

export async function mergeCustomers(
  user: AuthenticatedUser,
  duplicateId: string,
  rawInput: unknown,
) {
  requirePermission(user, 'customer.delete');
  const input = parseInput(mergeSchema, rawInput);
  if (input.targetId === duplicateId) {
    throw new DomainError('Choose a different customer to keep.', 'targetId');
  }
  const organizationId = user.organizationId;

  return prisma.$transaction(async (tx) => {
    await claimRequestKey(tx, user, rawInput, 'customer.merge');
    // Both rows locked, in a fixed order, so two merges can't cross.
    for (const id of [duplicateId, input.targetId].sort()) {
      await tx.$executeRaw`SELECT id FROM customers WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
    }
    const [duplicate, target] = await Promise.all([
      tx.customer.findFirst({ where: { id: duplicateId, organizationId } }),
      tx.customer.findFirst({ where: { id: input.targetId, organizationId } }),
    ]);
    if (!duplicate) throw new NotFoundError('customer');
    if (!target) throw new DomainError('Choose a customer from the list to keep.', 'targetId');
    if (!target.isActive) {
      throw new DomainError(
        `${target.name} is deleted. Restore them first, or keep another customer.`,
        'targetId',
      );
    }

    const from = { organizationId, customerId: duplicate.id };
    const to = { customerId: target.id };
    const moved = {
      vehicles: (await tx.vehicle.updateMany({ where: from, data: to })).count,
      appointments: (await tx.appointment.updateMany({ where: from, data: to })).count,
      jobCards: (await tx.jobCard.updateMany({ where: from, data: to })).count,
      quotations: (await tx.estimate.updateMany({ where: from, data: to })).count,
      approvals: (await tx.approval.updateMany({ where: from, data: to })).count,
      invoices: (await tx.invoice.updateMany({ where: from, data: to })).count,
      creditNotes: (await tx.creditNote.updateMany({ where: from, data: to })).count,
      signatures: (await tx.signature.updateMany({ where: from, data: to })).count,
      statusHistory: (
        await tx.jobStatusHistory.updateMany({
          where: { organizationId, changedByCustomerId: duplicate.id },
          data: { changedByCustomerId: target.id },
        })
      ).count,
      documents: (
        await tx.document.updateMany({
          where: { organizationId, entityType: 'Customer', entityId: duplicate.id },
          data: { entityId: target.id },
        })
      ).count,
    };

    // Fill what the kept customer is missing; never overwrite what it has.
    const filled = {
      ...(!target.email && duplicate.email ? { email: duplicate.email } : {}),
      ...(!target.address && duplicate.address ? { address: duplicate.address } : {}),
      ...(!target.taxNumber && duplicate.taxNumber ? { taxNumber: duplicate.taxNumber } : {}),
      ...(!target.customerCode && duplicate.customerCode
        ? { customerCode: duplicate.customerCode }
        : {}),
    };
    if (Object.keys(filled).length) {
      await tx.customer.update({ where: { id: target.id }, data: filled });
    }
    await tx.customer.update({ where: { id: duplicate.id }, data: { isActive: false } });

    const snapshot = (customer: typeof duplicate) => ({
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      taxNumber: customer.taxNumber,
      customerCode: customer.customerCode,
    });
    await writeAuditLog(tx, {
      organizationId,
      branchId: user.primaryBranchId,
      actorUserId: user.id,
      action: 'customer.merged_away',
      entityType: 'Customer',
      entityId: duplicate.id,
      beforeData: { ...snapshot(duplicate), isActive: duplicate.isActive },
      afterData: { isActive: false, mergedInto: target.id },
      metadata: { reason: input.reason ?? null, moved },
    });
    await writeAuditLog(tx, {
      organizationId,
      branchId: user.primaryBranchId,
      actorUserId: user.id,
      action: 'customer.merged_in',
      entityType: 'Customer',
      entityId: target.id,
      beforeData: snapshot(target),
      afterData: { ...filled, mergedFrom: duplicate.id },
      metadata: { reason: input.reason ?? null, moved, duplicate: snapshot(duplicate) },
    });
    await settleRequestKey(tx, user, rawInput, target.id);
    return { targetId: target.id, targetName: target.name, moved };
  });
}

/** What a merge would move — shown before it is confirmed. */
export async function getMergePreview(user: AuthenticatedUser, customerId: string) {
  requirePermission(user, 'customer.delete');
  const where = { organizationId: user.organizationId, customerId };
  const [vehicles, jobCards, quotations, invoices, creditNotes, appointments] = await Promise.all([
    prisma.vehicle.count({ where }),
    prisma.jobCard.count({ where }),
    prisma.estimate.count({ where }),
    prisma.invoice.count({ where }),
    prisma.creditNote.count({ where }),
    prisma.appointment.count({ where }),
  ]);
  return { vehicles, jobCards, quotations, invoices, creditNotes, appointments };
}

export type MergePreview = Awaited<ReturnType<typeof getMergePreview>>;
