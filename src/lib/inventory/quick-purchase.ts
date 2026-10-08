import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { hasPermission, requirePermission } from '@/lib/auth/authorize';
import { DomainError } from '@/lib/errors';
import { parseInput } from '@/lib/form-data';
import { claimRequestKey, settleRequestKey } from '@/lib/request-keys';
import { localDateString, parseCalendarDate } from '@/lib/format';
import { createPart } from '@/lib/inventory/parts';
import { createPurchaseInTransaction } from '@/lib/inventory/purchases';
import { LIKELY_SAME, similarParts } from '@/lib/inventory/part-match';

/*
 * A part bought for the car on the lift — the everyday case: someone runs to
 * the shop nearby, pays, and the part is fitted before the invoice is typed.
 *
 * From the invoice line, in one step, this records what really happened, by
 * the same rules as the Purchases screen (it calls them):
 *
 *   the part        picked from the catalogue, or added — after checking the
 *                   catalogue for one already there under another spelling;
 *   the purchase    from that shop, at the cost paid, received into stock now;
 *   the payment     paid now (cash or bank), or owed to the shop;
 *   the tax invoice usually comes later: the purchase waits on the Bills to
 *                   match list, its VAT held apart until it is matched. Its
 *                   number can be entered here if it is already in hand.
 *
 * The invoice then sells the part out of that stock, at that cost.
 */

const amount = (label: string) =>
  z
    .string({ error: `Enter the ${label}.` })
    .trim()
    .refine(
      (value) => /^\d+(\.\d{1,2})?$/.test(value) && Number(value) <= 1_000_000,
      `Enter the ${label} like 45 or 45.50.`,
    );

const schema = z
  .object({
    /** An existing part; blank adds the one described below. */
    partId: z.union([z.literal(''), z.uuid()]).optional(),
    name: z.string().trim().max(120).optional(),
    sku: z.string().trim().max(40).optional(),
    unitOfMeasure: z.string().trim().max(20).optional(),
    sellingPrice: z.string().trim().optional(),
    /** "1": the person saw the similar parts and this one is different. */
    confirmNew: z.string().optional(),
    supplierId: z.uuid('Choose the shop it was bought from.'),
    quantity: z
      .string({ error: 'Enter how many were bought.' })
      .trim()
      .refine(
        (value) => /^\d+(\.\d{1,3})?$/.test(value) && Number(value) > 0,
        'Enter how many were bought.',
      ),
    unitCost: amount('price paid for one, before VAT'),
    taxRate: z.string().trim().optional(),
    supplierInvoiceNumber: z.string().trim().max(60).optional(),
    supplierInvoiceDate: z.string().trim().optional(),
    /** cash · bank · later */
    paid: z.enum(['cash', 'bank', 'later'], { error: 'Say how the shop was paid.' }),
    requestKey: z.string().optional(),
  })
  .superRefine((input, context) => {
    if (!input.partId && (input.name ?? '').length < 2) {
      context.addIssue({ code: 'custom', path: ['name'], message: 'Enter the part name.' });
    }
  });

export type QuickPurchaseInput = z.input<typeof schema>;

/**
 * Refuses a new part when the catalogue already has one that is almost
 * certainly the same ("Brake pads" for "Brake pad", the same part number),
 * until the person confirms it is different.
 */
export async function refuseLikelyDuplicate(
  client: Prisma.TransactionClient,
  organizationId: string,
  typed: { name: string; sku?: string },
) {
  const existing = await client.part.findMany({
    where: { organizationId, isActive: true },
    select: { id: true, name: true, sku: true },
  });
  const same = similarParts(typed, existing, { threshold: LIKELY_SAME, limit: 3 });
  if (same.length) {
    throw new DomainError(
      `Already in the parts list: ${same.map(({ part }) => `“${part.name}” (${part.sku})`).join(', ')}. Pick it instead — or tick “This is a different part”.`,
      'name',
    );
  }
}

const TRANSACTION = { timeout: 90_000, maxWait: 10_000 };

/** Whether this user can record a part bought for a job (and so add one from an invoice line). */
export function canBuyForJob(user: AuthenticatedUser) {
  return hasPermission(user, 'purchase.create') && hasPermission(user, 'purchase.approve');
}

export async function buyPartForJob(user: AuthenticatedUser, rawInput: unknown) {
  const input = parseInput(schema, rawInput);
  requirePermission(user, 'purchase.create');
  requirePermission(user, 'purchase.approve');
  if (input.paid !== 'later') requirePermission(user, 'supplier_payment.create');
  if (input.supplierInvoiceDate && !parseCalendarDate(input.supplierInvoiceDate)) {
    throw new DomainError('Enter a valid date.', 'supplierInvoiceDate');
  }
  if (input.supplierInvoiceDate && input.supplierInvoiceDate > localDateString()) {
    throw new DomainError("The bill's date can't be in the future.", 'supplierInvoiceDate');
  }

  return prisma.$transaction(async (tx) => {
    await claimRequestKey(tx, user, rawInput, 'part.bought_for_job');

    let partId = input.partId || null;
    let created = false;
    if (partId) {
      const part = await tx.part.findFirst({
        where: { id: partId, organizationId: user.organizationId },
        select: { isActive: true, name: true },
      });
      if (!part) throw new DomainError('That part was not found. Pick it again.', 'partId');
      if (!part.isActive) {
        throw new DomainError(`“${part.name}” is no longer in use. Reactivate it first.`, 'partId');
      }
    } else {
      // Not a second copy of a part already there under another spelling.
      if (input.confirmNew !== '1') {
        await refuseLikelyDuplicate(tx, user.organizationId, { name: input.name!, sku: input.sku });
      }
      const part = await createPart(
        user,
        {
          name: input.name,
          sku: input.sku,
          unitOfMeasure: input.unitOfMeasure || 'piece',
          costPrice: input.unitCost,
          sellingPrice: input.sellingPrice,
          taxRate: input.taxRate,
          preferredSupplierId: input.supplierId,
        },
        tx,
      );
      partId = part.id;
      created = true;
    }

    const purchase = await createPurchaseInTransaction(
      tx,
      user,
      {
        supplierId: input.supplierId,
        supplierInvoiceNumber: input.supplierInvoiceNumber,
        supplierInvoiceDate: input.supplierInvoiceDate || localDateString(),
        notes: 'Bought for a job — entered from the invoice line.',
        items: [{ partId, quantity: input.quantity, unitCost: input.unitCost, taxRate: input.taxRate }],
        payment: input.paid === 'later' ? 'later' : 'now',
        method: input.paid === 'bank' ? 'BANK_TRANSFER' : input.paid === 'cash' ? 'CASH' : '',
        // The last price paid is the part's cost from now on.
        updateCostPrice: hasPermission(user, 'inventory.create') ? 'on' : '',
      },
      { receive: true },
    );

    await settleRequestKey(tx, user, rawInput, purchase.id);
    return {
      partId,
      created,
      purchaseId: purchase.id,
      purchaseNumber: purchase.purchaseNumber,
      billAwaited: !input.supplierInvoiceNumber,
    };
  }, TRANSACTION);
}
