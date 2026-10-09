import type { Prisma } from '@/generated/prisma/client';
import { signedToMilli } from '@/lib/money';
import { postMovement } from '@/lib/inventory/stock';

/*
 * Stock follows the credit note.
 *
 * A credit note line can say the part came back (returnedQuantity, at the
 * invoice line's cost). While the note stands, that quantity is back in
 * stock; once it is void, it is out again. Like an invoice's own stock
 * (lib/inventory/invoice-stock.ts), this compares what the note returns now
 * with what its CUSTOMER_RETURN movements already put back, part by part,
 * and posts only the difference — running it twice changes nothing.
 *
 * The cost comes off cost of sales on the credit note's own entry
 * (lib/accounting/postings.ts); these movements carry the quantity.
 */
export async function syncCreditNoteStock(
  tx: Prisma.TransactionClient,
  params: { organizationId: string; creditNoteId: string; userId: string },
) {
  const note = await tx.creditNote.findFirstOrThrow({
    where: { id: params.creditNoteId, organizationId: params.organizationId },
    select: {
      status: true,
      branchId: true,
      creditNoteNumber: true,
      items: { select: { partId: true, returnedQuantity: true, unitCost: true } },
    },
  });
  const live = note.status === 'ISSUED';

  const wanted = new Map<string, { milli: number; unitCost: string | null }>();
  if (live) {
    for (const item of note.items) {
      if (!item.partId || !item.returnedQuantity) continue;
      const milli = signedToMilli(item.returnedQuantity);
      if (milli <= 0) continue;
      const entry = wanted.get(item.partId) ?? { milli: 0, unitCost: null };
      entry.milli += milli;
      entry.unitCost = item.unitCost?.toString() ?? entry.unitCost;
      wanted.set(item.partId, entry);
    }
  }

  const moved = await tx.inventoryTransaction.groupBy({
    by: ['partId'],
    where: {
      organizationId: params.organizationId,
      creditNoteId: params.creditNoteId,
      transactionType: 'CUSTOMER_RETURN',
    },
    _sum: { quantity: true },
  });
  const back = new Map(moved.map((row) => [row.partId, signedToMilli(row._sum.quantity)]));

  for (const partId of [...new Set([...wanted.keys(), ...back.keys()])].sort()) {
    const difference = (wanted.get(partId)?.milli ?? 0) - (back.get(partId) ?? 0);
    if (difference === 0) continue;
    // Out again on a void: refused, like any movement, if it has since been sold.
    await postMovement(tx, {
      organizationId: params.organizationId,
      branchId: note.branchId,
      partId,
      type: 'CUSTOMER_RETURN',
      quantityMilli: difference,
      unitCost: wanted.get(partId)?.unitCost ?? null,
      creditNoteId: params.creditNoteId,
      performedByUserId: params.userId,
      note:
        difference > 0
          ? `Returned by the customer — ${note.creditNoteNumber}`
          : `Out again: ${note.creditNoteNumber} void`,
    });
  }
}
