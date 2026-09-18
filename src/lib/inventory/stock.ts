import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { DomainError, NotFoundError } from '@/lib/errors';
import { formatMilli, milliToString, signedToMilli } from '@/lib/money';

/*
 * Stock follows the schema's ledger rule (Part / InventoryTransaction):
 * there is no stock counter. Stock on hand for a part at a branch is always
 * SUM(inventory_transactions.quantity), signed — positive in, negative out.
 * Every movement is a new ledger row; rows are never edited.
 *
 * Concurrency: every stock-out locks the Part row first (SELECT … FOR
 * UPDATE), so two simultaneous issues of the same part are serialized and
 * the "enough stock?" check can't be raced into a negative balance.
 */

/** Stock on hand in integer thousandths of the part's unit. */
export async function getStockOnHand(
  client: Prisma.TransactionClient,
  organizationId: string,
  branchId: string,
  partId: string,
): Promise<number> {
  const result = await client.inventoryTransaction.aggregate({
    where: { organizationId, branchId, partId },
    _sum: { quantity: true },
  });
  return signedToMilli(result._sum.quantity);
}

/** Stock on hand for every part at a branch, in thousandths. */
export async function getStockByPart(organizationId: string, branchId: string): Promise<Map<string, number>> {
  const rows = await prisma.inventoryTransaction.groupBy({
    by: ['partId'],
    where: { organizationId, branchId },
    _sum: { quantity: true },
  });
  return new Map(rows.map((row) => [row.partId, signedToMilli(row._sum.quantity)]));
}

/**
 * Issues stock to a job: writes one JOB_CONSUMPTION ledger row (negative
 * quantity) linked to the PartUsage. Must run in the same transaction as the
 * PartUsage it records, so both succeed or both fail. Refuses to take stock
 * below zero.
 */
export async function issueStockToJob(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    branchId: string;
    partId: string;
    quantityMilli: number;
    unitCost: string;
    partUsageId: string;
    performedByUserId: string;
    note: string;
  },
) {
  if (params.quantityMilli <= 0) throw new DomainError('Quantity must be greater than zero.', 'quantity');
  await lockPart(tx, params.organizationId, params.partId);

  const onHand = await getStockOnHand(tx, params.organizationId, params.branchId, params.partId);
  if (onHand < params.quantityMilli) {
    throw new DomainError(
      onHand <= 0
        ? 'This part is out of stock at this branch.'
        : `Only ${formatMilli(onHand)} in stock at this branch.`,
      'quantity',
    );
  }

  return tx.inventoryTransaction.create({
    data: {
      organizationId: params.organizationId,
      branchId: params.branchId,
      partId: params.partId,
      transactionType: 'JOB_CONSUMPTION',
      quantity: `-${milliToString(params.quantityMilli)}`,
      unitCost: params.unitCost,
      partUsageId: params.partUsageId,
      performedByUserId: params.performedByUserId,
      note: params.note,
    },
  });
}

/** Locks the part row for the rest of the transaction; also proves it belongs to the organization. */
export async function lockPart(tx: Prisma.TransactionClient, organizationId: string, partId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM parts WHERE id = ${partId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw new NotFoundError('part');
}
