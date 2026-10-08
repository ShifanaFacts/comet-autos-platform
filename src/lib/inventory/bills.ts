import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { DomainError, NotFoundError } from '@/lib/errors';
import { parseInput } from '@/lib/form-data';
import { claimRequestKey, settleRequestKey } from '@/lib/request-keys';
import { emptyToNull } from '@/lib/normalize';
import { localDateString, parseCalendarDate } from '@/lib/format';
import { filsToString, formatMilli, signedToMilli, toFils } from '@/lib/money';
import { syncPosting } from '@/lib/accounting/journal';
import { assertSupplierInvoiceFree } from '@/lib/inventory/purchases';

/*
 * Matching the supplier's tax invoice to the purchase already recorded.
 *
 * Parts bought for a job are recorded when they arrive; the shop's tax
 * invoice often comes days later. Until it does, the purchase is on the
 * "Bills to match" list and its input VAT waits in "Input VAT — awaiting
 * tax invoice": it can't be claimed without the tax invoice.
 *
 * When the bill comes, it is typed in as printed — number, date, amount
 * before VAT, VAT, total — and compared with what was recorded:
 *
 *   it agrees (to 0.10 on each figure, for the shop's rounding)
 *       → matched: the VAT moves to Input VAT, claimable in the period the
 *         bill was received (its own entry, PURCHASE_BILL);
 *   it doesn't
 *       → refused, showing which figure differs and by how much, so the
 *         wrong entry is found rather than papered over.
 *
 * And when the shop will never give a tax invoice, the purchase is closed as
 * "no tax invoice": its VAT can't be claimed and becomes part of the cost.
 *
 * Purchases entered with the supplier's invoice number in hand never wait
 * here (lib/inventory/purchases.ts headerData).
 */

/** Rounding a shop's bill may differ by, on each figure, in fils. */
export const BILL_TOLERANCE_FILS = 10;

const money = (label: string) =>
  z
    .string({ error: `Enter the ${label}.` })
    .trim()
    .refine((value) => /^\d+(\.\d{1,2})?$/.test(value), `Enter the ${label} like 45 or 45.50.`);

const date = (label: string) =>
  z
    .string({ error: `Enter the ${label}.` })
    .trim()
    .refine((value) => parseCalendarDate(value) !== null, `Enter the ${label}.`)
    .refine((value) => value <= localDateString(), `The ${label} can't be in the future.`);

const matchSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('RECEIVED'),
    supplierInvoiceNumber: z
      .string({ error: "Enter the bill's number." })
      .trim()
      .min(1, "Enter the bill's number.")
      .max(60),
    billDate: date("bill's date"),
    receivedOn: date('day it was received'),
    subtotal: money('amount before VAT'),
    taxAmount: money('VAT'),
    totalAmount: money('total'),
    note: z.string().trim().max(500).optional(),
    requestKey: z.string().optional(),
  }),
  z.object({
    outcome: z.literal('NO_TAX_INVOICE'),
    note: z
      .string({ error: 'Say why there is no tax invoice.' })
      .trim()
      .min(3, 'Say why there is no tax invoice.')
      .max(500),
    requestKey: z.string().optional(),
  }),
]);

/** Each figure of the bill against the purchase: what differs, in fils (bill − recorded). */
export function compareBill(
  recorded: { subtotal: string; taxAmount: string; totalAmount: string },
  bill: { subtotal: string; taxAmount: string; totalAmount: string },
) {
  const rows = (['subtotal', 'taxAmount', 'totalAmount'] as const).map((field) => {
    const difference = toFils(bill[field]) - toFils(recorded[field]);
    return { field, recorded: recorded[field], bill: bill[field], difference };
  });
  return {
    rows,
    agrees: rows.every((row) => Math.abs(row.difference) <= BILL_TOLERANCE_FILS),
  };
}

const LABEL = { subtotal: 'before VAT', taxAmount: 'VAT', totalAmount: 'total' } as const;

/** The purchases still waiting for their tax invoice, oldest first. */
export async function listBillsAwaiting(user: AuthenticatedUser) {
  requirePermission(user, 'purchase.view');
  const purchases = await prisma.purchase.findMany({
    where: {
      organizationId: user.organizationId,
      billStatus: 'PENDING',
      status: { notIn: ['CANCELLED'] },
    },
    orderBy: [{ createdAt: 'asc' }],
    select: {
      id: true,
      purchaseNumber: true,
      status: true,
      createdAt: true,
      receivedAt: true,
      supplierInvoiceDate: true,
      subtotal: true,
      taxAmount: true,
      totalAmount: true,
      supplier: { select: { id: true, name: true } },
      items: {
        select: { quantityOrdered: true, part: { select: { name: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
  });
  const today = parseCalendarDate(localDateString())!.getTime();
  return purchases.map((purchase) => {
    const since = purchase.supplierInvoiceDate ?? purchase.receivedAt ?? purchase.createdAt;
    return {
      ...purchase,
      subtotal: purchase.subtotal?.toString() ?? '0.00',
      taxAmount: purchase.taxAmount?.toString() ?? '0.00',
      totalAmount: purchase.totalAmount?.toString() ?? '0.00',
      what: purchase.items
        .map((item) => `${formatMilli(signedToMilli(item.quantityOrdered))} × ${item.part.name}`)
        .join(', '),
      days: Math.max(0, Math.floor((today - since.getTime()) / 86_400_000)),
    };
  });
}

export type BillAwaiting = Awaited<ReturnType<typeof listBillsAwaiting>>[number];

/** Records the supplier's tax invoice against a purchase — or that none will come. */
export async function matchBill(user: AuthenticatedUser, purchaseId: string, rawInput: unknown) {
  const input = parseInput(matchSchema, rawInput);

  return prisma.$transaction(async (tx) => {
    await claimRequestKey(tx, user, rawInput, 'purchase.bill_matched');
    await tx.$executeRaw`SELECT id FROM purchases WHERE id = ${purchaseId}::uuid AND organization_id = ${user.organizationId}::uuid FOR UPDATE`;
    const purchase = await tx.purchase.findFirst({
      where: { id: purchaseId, organizationId: user.organizationId },
      select: {
        id: true,
        branchId: true,
        supplierId: true,
        purchaseNumber: true,
        status: true,
        billStatus: true,
        subtotal: true,
        taxAmount: true,
        totalAmount: true,
        supplierInvoiceDate: true,
        items: { select: { quantityReceived: true } },
      },
    });
    if (!purchase) throw new NotFoundError('purchase');
    requirePermission(user, 'purchase.edit', { branchId: purchase.branchId });
    if (purchase.status === 'CANCELLED') throw new DomainError('This purchase is cancelled.');
    if (purchase.billStatus !== 'PENDING') {
      throw new DomainError(
        purchase.billStatus === 'RECEIVED'
          ? 'The tax invoice for this purchase is already matched.'
          : 'This purchase is already closed as having no tax invoice.',
      );
    }
    // Anything already received was booked with its VAT held apart: moving it
    // takes its own entry. Nothing received yet: deliveries book it directly.
    const delivered = purchase.items.some((item) => signedToMilli(item.quantityReceived) > 0);

    if (input.outcome === 'RECEIVED') {
      const recorded = {
        subtotal: purchase.subtotal?.toString() ?? '0.00',
        taxAmount: purchase.taxAmount?.toString() ?? '0.00',
        totalAmount: purchase.totalAmount?.toString() ?? '0.00',
      };
      const comparison = compareBill(recorded, input);
      if (!comparison.agrees) {
        const off = comparison.rows
          .filter((row) => Math.abs(row.difference) > BILL_TOLERANCE_FILS)
          .map(
            (row) =>
              `${LABEL[row.field]}: bill ${row.bill}, recorded ${row.recorded} (${row.difference > 0 ? '+' : '−'}${filsToString(Math.abs(row.difference))})`,
          )
          .join('; ');
        throw new DomainError(
          `The bill doesn't agree with ${purchase.purchaseNumber} — ${off}. Check the quantity and price on the bill against the purchase.`,
          'subtotal',
        );
      }
      await assertSupplierInvoiceFree(
        tx,
        user.organizationId,
        purchase.supplierId,
        input.supplierInvoiceNumber,
        purchase.id,
      );
      await tx.purchase.update({
        where: { id: purchase.id },
        data: {
          billStatus: 'RECEIVED',
          supplierInvoiceNumber: input.supplierInvoiceNumber,
          supplierInvoiceDate: parseCalendarDate(input.billDate),
          billReceivedOn: parseCalendarDate(input.receivedOn),
          billSubtotal: input.subtotal,
          billTaxAmount: input.taxAmount,
          billTotalAmount: input.totalAmount,
          billNote: emptyToNull(input.note),
          billMatchedByUserId: delivered ? user.id : null,
        },
      });
    } else {
      await tx.purchase.update({
        where: { id: purchase.id },
        data: {
          billStatus: 'NO_TAX_INVOICE',
          billReceivedOn: parseCalendarDate(localDateString()),
          billNote: input.note,
          billMatchedByUserId: delivered ? user.id : null,
        },
      });
    }
    await syncPosting(tx, user.organizationId, 'PURCHASE_BILL', purchase.id, user.id);

    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: purchase.branchId,
      actorUserId: user.id,
      action: input.outcome === 'RECEIVED' ? 'purchase.bill_matched' : 'purchase.no_tax_invoice',
      entityType: 'Purchase',
      entityId: purchase.id,
      beforeData: { billStatus: 'PENDING' },
      afterData:
        input.outcome === 'RECEIVED'
          ? {
              billStatus: 'RECEIVED',
              supplierInvoiceNumber: input.supplierInvoiceNumber,
              billDate: input.billDate,
              receivedOn: input.receivedOn,
              subtotal: input.subtotal,
              taxAmount: input.taxAmount,
              totalAmount: input.totalAmount,
            }
          : { billStatus: 'NO_TAX_INVOICE', note: input.note },
      metadata: { purchaseNumber: purchase.purchaseNumber },
    });
    await settleRequestKey(tx, user, rawInput, purchase.id);
    return { purchaseId: purchase.id };
  });
}
