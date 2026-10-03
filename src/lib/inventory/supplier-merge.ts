import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { DomainError, NotFoundError } from '@/lib/errors';
import { parseInput } from '@/lib/form-data';
import { claimRequestKey, settleRequestKey } from '@/lib/request-keys';

/*
 * Merging a duplicate supplier into the one to keep — the same supplier
 * entered twice ("Al Amani" and "Al Amani Trading L.L.C"), splitting their
 * purchases, what is owed to them and their statement across two records.
 * Merging moves everything the duplicate has onto the supplier kept, then
 * archives the duplicate:
 *
 *   purchases (with their deliveries, supplier payments and bills) · parts
 *   that name it as their usual supplier · files filed against it ·
 *   expenses entered under its name
 *
 * The books need no entry: what is owed to a supplier is read from its
 * purchases and their payments, so moving those moves the balance.
 *
 * Contact details the kept supplier lacks (TRN, contact, phone, email,
 * address) are taken from the duplicate; nothing it already has is
 * overwritten. Refused while both have a live purchase for the same supplier
 * invoice number — the same bill entered twice must be sorted out first.
 */

const mergeSchema = z.object({
  targetId: z.uuid({ error: 'Choose the supplier to keep.' }),
  reason: z.string().trim().max(500).optional(),
  requestKey: z.string().optional(),
});

export async function mergeSuppliers(
  user: AuthenticatedUser,
  duplicateId: string,
  rawInput: unknown,
) {
  requirePermission(user, 'inventory.delete');
  const input = parseInput(mergeSchema, rawInput);
  if (input.targetId === duplicateId) {
    throw new DomainError('Choose a different supplier to keep.', 'targetId');
  }
  const organizationId = user.organizationId;

  return prisma.$transaction(async (tx) => {
    await claimRequestKey(tx, user, rawInput, 'supplier.merge');
    // Both rows locked, in a fixed order, so two merges can't cross.
    for (const id of [duplicateId, input.targetId].sort()) {
      await tx.$executeRaw`SELECT id FROM suppliers WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
    }
    const [duplicate, target] = await Promise.all([
      tx.supplier.findFirst({ where: { id: duplicateId, organizationId } }),
      tx.supplier.findFirst({ where: { id: input.targetId, organizationId } }),
    ]);
    if (!duplicate) throw new NotFoundError('supplier');
    if (!target) throw new DomainError('Choose a supplier from the list to keep.', 'targetId');
    if (!target.isActive) {
      throw new DomainError(
        `${target.name} is deleted. Restore them first, or keep another supplier.`,
        'targetId',
      );
    }

    // The same bill on both would become two copies of one bill.
    const live = (supplierId: string) =>
      tx.purchase.findMany({
        where: {
          organizationId,
          supplierId,
          status: { not: 'CANCELLED' },
          supplierInvoiceNumber: { not: null },
        },
        select: { purchaseNumber: true, supplierInvoiceNumber: true },
      });
    const [mine, theirs] = await Promise.all([live(duplicate.id), live(target.id)]);
    const kept = new Map(theirs.map((p) => [p.supplierInvoiceNumber!.toUpperCase(), p]));
    const clashes = mine.filter((p) => kept.has(p.supplierInvoiceNumber!.toUpperCase()));
    if (clashes.length) {
      throw new DomainError(
        `Both suppliers have invoice ${clashes
          .map(
            (p) =>
              `${p.supplierInvoiceNumber} (${p.purchaseNumber} and ${kept.get(p.supplierInvoiceNumber!.toUpperCase())!.purchaseNumber})`,
          )
          .join(', ')} — the same bill entered twice. Cancel or correct one of them first.`,
      );
    }

    const moved = {
      purchases: (
        await tx.purchase.updateMany({
          where: { organizationId, supplierId: duplicate.id },
          data: { supplierId: target.id },
        })
      ).count,
      parts: (
        await tx.part.updateMany({
          where: { organizationId, preferredSupplierId: duplicate.id },
          data: { preferredSupplierId: target.id },
        })
      ).count,
      documents: (
        await tx.document.updateMany({
          where: { organizationId, entityType: 'Supplier', entityId: duplicate.id },
          data: { entityId: target.id },
        })
      ).count,
      // Expenses name their vendor in words: the duplicate's name becomes the kept one's.
      expenses: (
        await tx.expense.updateMany({
          where: { organizationId, vendorName: { equals: duplicate.name, mode: 'insensitive' } },
          data: { vendorName: target.name },
        })
      ).count,
    };

    // Fill what the kept supplier is missing; never overwrite what it has.
    const filled = {
      ...(!target.taxNumber && duplicate.taxNumber ? { taxNumber: duplicate.taxNumber } : {}),
      ...(!target.contactName && duplicate.contactName
        ? { contactName: duplicate.contactName }
        : {}),
      ...(!target.phone && duplicate.phone ? { phone: duplicate.phone } : {}),
      ...(!target.email && duplicate.email ? { email: duplicate.email } : {}),
      ...(!target.address && duplicate.address ? { address: duplicate.address } : {}),
    };
    if (Object.keys(filled).length) {
      await tx.supplier.update({ where: { id: target.id }, data: filled });
    }
    await tx.supplier.update({ where: { id: duplicate.id }, data: { isActive: false } });

    const snapshot = (supplier: typeof duplicate) => ({
      name: supplier.name,
      taxNumber: supplier.taxNumber,
      contactName: supplier.contactName,
      phone: supplier.phone,
      email: supplier.email,
      address: supplier.address,
    });
    await writeAuditLog(tx, {
      organizationId,
      branchId: user.primaryBranchId,
      actorUserId: user.id,
      action: 'supplier.merged_away',
      entityType: 'Supplier',
      entityId: duplicate.id,
      beforeData: { ...snapshot(duplicate), isActive: duplicate.isActive },
      afterData: { isActive: false, mergedInto: target.id },
      metadata: { reason: input.reason ?? null, moved },
    });
    await writeAuditLog(tx, {
      organizationId,
      branchId: user.primaryBranchId,
      actorUserId: user.id,
      action: 'supplier.merged_in',
      entityType: 'Supplier',
      entityId: target.id,
      beforeData: snapshot(target),
      afterData: { ...filled, mergedFrom: duplicate.id },
      metadata: { reason: input.reason ?? null, moved, duplicate: snapshot(duplicate) },
    });
    await settleRequestKey(tx, user, rawInput, target.id);
    return { targetId: target.id, targetName: target.name, moved };
  });
}

/** What a merge would move, and the suppliers it could go into — shown before it is confirmed. */
export async function getSupplierMergeOptions(user: AuthenticatedUser, supplierId: string) {
  requirePermission(user, 'inventory.delete');
  const organizationId = user.organizationId;
  const [purchases, parts, others] = await Promise.all([
    prisma.purchase.count({ where: { organizationId, supplierId } }),
    prisma.part.count({ where: { organizationId, preferredSupplierId: supplierId } }),
    prisma.supplier.findMany({
      where: { organizationId, isActive: true, id: { not: supplierId } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, taxNumber: true },
    }),
  ]);
  return { purchases, parts, others };
}

export type SupplierMergeOptions = Awaited<ReturnType<typeof getSupplierMergeOptions>>;
