import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { hasPermission, requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { DomainError } from '@/lib/errors';
import { parseInput, ValidationError } from '@/lib/form-data';
import { claimRequestKey, settleRequestKey } from '@/lib/request-keys';
import { emptyToNull } from '@/lib/normalize';
import { localDateString, parseCalendarDate } from '@/lib/format';
import { filsToString, formatMilli, milliToString, multiplyQuantity, toFils, toMilli } from '@/lib/money';
import {
  getStockByPart,
  getStockOnHand,
  postMovement,
  resolveInventoryBranch,
} from '@/lib/inventory/stock';

/*
 * A stock count: walk the shelves, write down what is really there, and let
 * the system correct itself to it.
 *
 * The count sheet lists every part with what the system thinks is on hand.
 * Counted figures are typed beside them; parts not counted are left alone.
 * Posting it records one StockCount and, for each part whose count differs,
 * an ADJUSTMENT movement linked to it — at the part's cost — so stock goes
 * up or down to what was counted, and the books with it (Inventory against
 * Inventory adjustments). Parts that agree are recorded as counted too.
 *
 * Stock is read again inside the transaction, so a sale made while the
 * sheet was being filled is not undone: the count is applied to the stock
 * as it is when it is posted.
 */

const schema = z.object({
  countedOn: z
    .string({ error: 'Choose the day of the count.' })
    .trim()
    .refine((value) => parseCalendarDate(value) !== null, 'Choose the day of the count.')
    .refine((value) => value <= localDateString(), "The count can't be dated in the future."),
  note: z.string().trim().max(500).optional(),
  /** Part id → quantity counted; blank means not counted. */
  counts: z.record(
    z.uuid(),
    z
      .string()
      .trim()
      .refine(
        (value) => value === '' || (/^\d+(\.\d{1,3})?$/.test(value) && Number(value) <= 1_000_000),
        'Enter what was counted (up to 3 decimals).',
      ),
  ),
  requestKey: z.string().optional(),
});

const TRANSACTION = { timeout: 120_000, maxWait: 10_000 };

/** The count sheet: every active part, what the system holds and what it is worth. */
export async function getStockCountSheet(user: AuthenticatedUser) {
  requirePermission(user, 'inventory.view');
  const branch = await resolveInventoryBranch(user);
  const [parts, stock, inventoryAccount, recent] = await Promise.all([
    prisma.part.findMany({
      where: { organizationId: user.organizationId, isActive: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        sku: true,
        name: true,
        category: true,
        unitOfMeasure: true,
        defaultCostPrice: true,
      },
    }),
    getStockByPart(user.organizationId, branch.id),
    prisma.chartOfAccount.findFirst({
      where: { organizationId: user.organizationId, role: 'INVENTORY' },
      select: { id: true, accountCode: true, accountName: true },
    }),
    prisma.stockCount.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        countNumber: true,
        countedOn: true,
        partsCounted: true,
        note: true,
        createdBy: { select: { fullName: true } },
        _count: { select: { movements: true } },
      },
    }),
  ]);
  const lines = parts.map((part) => {
    const onHandMilli = stock.get(part.id) ?? 0;
    const cost = part.defaultCostPrice?.toString() ?? null;
    return {
      ...part,
      cost,
      onHandMilli,
      onHand: formatMilli(onHandMilli),
      valueFils: cost && onHandMilli > 0 ? multiplyQuantity(milliToString(onHandMilli), cost) : 0,
    };
  });
  // What the shelves are worth at cost, beside what the books say they are.
  const ledger = inventoryAccount
    ? await prisma.journalEntryLine.aggregate({
        where: { organizationId: user.organizationId, chartOfAccountId: inventoryAccount.id },
        _sum: { debitAmount: true, creditAmount: true },
      })
    : null;
  const bookFils = ledger
    ? toFils((ledger._sum.debitAmount ?? 0).toString()) -
      toFils((ledger._sum.creditAmount ?? 0).toString())
    : 0;
  const stockFils = lines.reduce((sum, line) => sum + line.valueFils, 0);
  return {
    branch,
    lines,
    recent,
    canPost: hasPermission(user, 'inventory.approve', { branchId: branch.id }),
    value: {
      stock: filsToString(stockFils),
      books: filsToString(Math.abs(bookFils)),
      booksNegative: bookFils < 0,
      difference: filsToString(Math.abs(stockFils - bookFils)),
      /** Positive: the shelves are worth more than the books say. */
      differenceSign: Math.sign(stockFils - bookFils),
      account: inventoryAccount,
    },
  };
}

export type StockCountSheet = Awaited<ReturnType<typeof getStockCountSheet>>;

/** The next count number, SC-0001 onwards; the lock keeps two counts from sharing one. */
async function nextCountNumber(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  organizationId: string,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`stock-count:${organizationId}`}))`;
  const count = await tx.stockCount.count({ where: { organizationId } });
  return `SC-${String(count + 1).padStart(4, '0')}`;
}

/** Posts a stock count: stock corrected to what was counted, part by part. */
export async function postStockCount(user: AuthenticatedUser, rawInput: unknown) {
  const raw = { ...(rawInput as Record<string, unknown>) };
  if (typeof raw.counts === 'string') {
    try {
      raw.counts = JSON.parse(raw.counts);
    } catch {
      throw new ValidationError({ counts: 'The count could not be read. Please try again.' });
    }
  }
  const input = parseInput(schema, raw);
  const counted = Object.entries(input.counts).filter(([, value]) => value !== '');
  if (counted.length === 0) throw new DomainError('Enter what was counted for at least one part.');

  return prisma.$transaction(async (tx) => {
    await claimRequestKey(tx, user, rawInput, 'inventory.stock_count');
    const branch = await resolveInventoryBranch(user, tx);
    requirePermission(user, 'inventory.approve', { branchId: branch.id });
    const parts = await tx.part.findMany({
      where: { organizationId: user.organizationId, id: { in: counted.map(([id]) => id) } },
      select: { id: true, sku: true, name: true, defaultCostPrice: true },
    });
    const byId = new Map(parts.map((part) => [part.id, part]));

    const countNumber = await nextCountNumber(tx, user.organizationId);
    const count = await tx.stockCount.create({
      data: {
        organizationId: user.organizationId,
        branchId: branch.id,
        countNumber,
        countedOn: parseCalendarDate(input.countedOn)!,
        note: emptyToNull(input.note),
        partsCounted: counted.length,
        createdByUserId: user.id,
      },
    });

    const changes: { sku: string; from: string; to: string }[] = [];
    for (const [partId, value] of counted) {
      const part = byId.get(partId);
      if (!part) throw new DomainError('A part on the count was not found. Open the count again.');
      // Read now, in the transaction: what is on hand as the count is posted.
      const onHand = await getStockOnHand(tx, user.organizationId, branch.id, part.id);
      const difference = toMilli(value) - onHand;
      if (difference === 0) continue;
      if (!part.defaultCostPrice) {
        throw new DomainError(
          `“${part.name}” has no cost price, so the difference can't be valued. Set its cost on the part first.`,
          `counts.${part.id}`,
        );
      }
      await postMovement(tx, {
        organizationId: user.organizationId,
        branchId: branch.id,
        partId: part.id,
        type: 'ADJUSTMENT',
        quantityMilli: difference,
        unitCost: part.defaultCostPrice.toString(),
        stockCountId: count.id,
        performedByUserId: user.id,
        note: `Stock count ${countNumber}: counted ${formatMilli(toMilli(value))}, system had ${formatMilli(onHand)}`,
      });
      changes.push({ sku: part.sku, from: milliToString(Math.max(onHand, 0)), to: value });
    }

    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: branch.id,
      actorUserId: user.id,
      action: 'inventory.stock_counted',
      entityType: 'StockCount',
      entityId: count.id,
      afterData: {
        countNumber,
        countedOn: input.countedOn,
        partsCounted: counted.length,
        corrected: changes,
      },
    });
    await settleRequestKey(tx, user, rawInput, count.id);
    return { stockCountId: count.id, countNumber, corrected: changes.length, counted: counted.length };
  }, TRANSACTION);
}
