/**
 * Integration tests for purchase discounts and paying on receipt (Step 4):
 *
 *  - a discounted purchase (line and bill discounts) received in two
 *    deliveries and paid in two parts as the goods came in: totals, VAT,
 *    stock, stock value, input VAT, trade payables, supplier payments, the
 *    supplier statement, Suppliers owed, the VAT return, the balance sheet
 *    and P&L — and the deliveries add up to the bill exactly, to the fil;
 *  - pay later with a due date: nothing paid, aged from the due date;
 *  - a return on a discounted line comes off at exactly what it was booked;
 *  - the optional cost-price update, off unless ticked;
 *  - paying on receipt needs the supplier-payment right; pay later doesn't;
 *  - a purchase with no discount is valued, posted and reported exactly as
 *    before discounts existed.
 *
 * Every record is made in a throwaway test organization.
 *
 *   npm run test:integration
 */
import 'dotenv/config';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AccountRole } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { AuthError } from '@/lib/auth/authorize';
import { ensureChart } from '@/lib/accounting/chart';
import { countUnbooked } from '@/lib/accounting/entries';
import { getBalanceSheet, getLedgerProfitAndLoss } from '@/lib/accounting/reports';
import { createPurchase, receivePurchase } from '@/lib/inventory/purchases';
import { getStockOnHand, postMovement } from '@/lib/inventory/stock';
import { getPayables } from '@/lib/finance/supplier-payments';
import { getSupplierStatement } from '@/lib/finance/statements';
import { getVatReturn } from '@/lib/finance/vat';
import { calculateLine, filsToString, toFils } from '@/lib/money';
import { localDateString } from '@/lib/format';
import { createTestOrg, expectDomainError, RUN, type TestOrg } from './support';

let a: TestOrg;
let roles: Record<AccountRole, string>;

before(async () => {
  a = await createTestOrg('Purchase discounts', [
    { sku: `PD-A-${RUN}`, name: 'Brake disc', cost: '100.00', price: '150.00', stock: '0' },
    { sku: `PD-B-${RUN}`, name: 'Clip', cost: '33.33', price: '50.00', stock: '0' },
    { sku: `PD-C-${RUN}`, name: 'Filter', cost: '20.00', price: '30.00', stock: '0' },
    { sku: `PD-D-${RUN}`, name: 'Bulb', cost: '33.33', price: '45.00', stock: '0' },
    { sku: `PD-E-${RUN}`, name: 'Wiper', cost: '25.00', price: '40.00', stock: '0' },
  ]);
  roles = await prisma.$transaction((tx) => ensureChart(tx, a.organizationId));
});

after(async () => {
  await prisma.$disconnect();
});

const part = (letter: string) => a.parts[`PD-${letter}-${RUN}`].id;
const daysAgo = (days: number) => localDateString(new Date(Date.now() - days * 86_400_000));

async function supplier(name: string) {
  return prisma.supplier.create({
    data: { organizationId: a.organizationId, name: `${name} ${RUN}` },
  });
}

const itemsOf = (purchaseId: string) =>
  prisma.purchaseItem.findMany({
    where: { purchaseId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

/** Net debit per account, in fils, over the stock movements of a purchase. */
async function bookedForPurchase(purchaseId: string) {
  const movements = await prisma.inventoryTransaction.findMany({
    where: { purchaseItem: { purchaseId } },
    select: { id: true },
  });
  return bookedFor(movements.map((m) => m.id));
}

async function bookedFor(sourceIds: string[]) {
  const lines = await prisma.journalEntryLine.findMany({
    where: { organizationId: a.organizationId, journalEntry: { sourceId: { in: sourceIds } } },
    select: { chartOfAccountId: true, debitAmount: true, creditAmount: true },
  });
  const net = new Map<string, number>();
  for (const line of lines) {
    const value = toFils(line.debitAmount.toString()) - toFils(line.creditAmount.toString());
    net.set(line.chartOfAccountId, (net.get(line.chartOfAccountId) ?? 0) + value);
  }
  for (const [key, value] of net) if (value === 0) net.delete(key);
  return net;
}

/** An account's balance (debit positive), in fils, across the whole organization. */
async function balanceOf(accountId: string) {
  const lines = await prisma.journalEntryLine.findMany({
    where: { organizationId: a.organizationId, chartOfAccountId: accountId },
    select: { debitAmount: true, creditAmount: true },
  });
  return lines.reduce(
    (sum, line) => sum + toFils(line.debitAmount.toString()) - toFils(line.creditAmount.toString()),
    0,
  );
}

const onHand = (partId: string) =>
  getStockOnHand(prisma, a.organizationId, a.branchId, partId).then((milli) => milli / 1000);

describe('a discounted purchase, received and paid in two parts', () => {
  let purchaseId: string;
  let supplierId: string;

  before(async () => {
    supplierId = (await supplier('Discount Parts')).id;
    // A: 10 × 100.00 less 5% = 950.00. B: 3 × 33.33 = 99.99. Less 10.00 on the bill.
    const purchase = await createPurchase(a.owner, {
      supplierId,
      supplierInvoiceNumber: `DISC-${RUN}`,
      items: [
        {
          partId: part('A'),
          quantity: '10',
          unitCost: '100',
          taxRate: '5',
          discountType: 'PERCENT',
          discountValue: '5',
        },
        { partId: part('B'), quantity: '3', unitCost: '33.33', taxRate: '5' },
      ],
      billDiscountType: 'AMOUNT',
      billDiscountValue: '10',
    });
    purchaseId = purchase.id;
  });

  test('priced on the server: line discount, bill discount shared to the fil, VAT after both', async () => {
    const purchase = await prisma.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
    assert.equal(filsToString(toFils(purchase.subtotal!.toString())), '1039.99');
    assert.equal(filsToString(toFils(purchase.taxAmount!.toString())), '52.00');
    assert.equal(filsToString(toFils(purchase.totalAmount!.toString())), '1091.99');
    assert.equal(purchase.billDiscountType, 'AMOUNT');
    assert.equal(filsToString(toFils(purchase.billDiscountAmount.toString())), '10.00');
    const [lineA, lineB] = await itemsOf(purchaseId);
    assert.equal(filsToString(toFils(lineA.discountAmount.toString())), '50.00');
    // The 10.00 split 9.05 / 0.95 in proportion to 950.00 / 99.99.
    assert.equal(filsToString(toFils(lineA.netAmount!.toString())), '940.95');
    assert.equal(filsToString(toFils(lineB.netAmount!.toString())), '99.04');
    assert.equal(filsToString(toFils(lineA.taxAmount!.toString())), '47.05');
    assert.equal(filsToString(toFils(lineB.taxAmount!.toString())), '4.95');
  });

  test('first delivery (4 of A, all of B), 300 paid now, cost prices updated when ticked', async () => {
    const [lineA, lineB] = await itemsOf(purchaseId);
    const result = await receivePurchase(
      a.owner,
      purchaseId,
      { [lineA.id]: '4', [lineB.id]: '3' },
      { payment: 'now', payAmount: '300', method: 'CASH', updateCostPrice: 'on' },
    );
    assert.equal(result.payment?.amount, '300.00');
    // 4 of 940.95 = 376.38, VAT 18.82; B whole: 99.04, VAT 4.95.
    const booked = await bookedForPurchase(purchaseId);
    assert.equal(booked.get(roles.INVENTORY), toFils('475.42'));
    assert.equal(booked.get(roles.VAT_INPUT), toFils('23.77'));
    assert.equal(booked.get(roles.ACCOUNTS_PAYABLE), -toFils('499.19'));
    assert.equal(await onHand(part('A')), 4);
    assert.equal(await onHand(part('B')), 3);
    const parts = await prisma.part.findMany({ where: { id: { in: [part('A'), part('B')] } } });
    const cost = new Map(parts.map((p) => [p.id, p.defaultCostPrice?.toString()]));
    assert.equal(cost.get(part('A')), '94.1', '940.95 / 10, half-up to the fil');
    assert.equal(cost.get(part('B')), '33.01', '99.04 / 3');
    const owed = (await getPayables(a.owner, { supplierId })).rows.find((r) => r.id === purchaseId);
    assert.equal(owed?.received, '499.19');
    assert.equal(owed?.paid, '300.00');
    assert.equal(owed?.balance, '199.19');
  });

  test('second delivery (6 of A), the rest paid now: deliveries add up to the bill exactly', async () => {
    const [lineA] = await itemsOf(purchaseId);
    const result = await receivePurchase(
      a.owner,
      purchaseId,
      { [lineA.id]: '6' },
      { payment: 'now', method: 'CASH' },
    );
    // Blank amount: everything owed — 199.19 + 564.57 + 28.23.
    assert.equal(result.payment?.amount, '791.99');
    assert.equal(result.status, 'RECEIVED');
    const booked = await bookedForPurchase(purchaseId);
    assert.equal(booked.get(roles.INVENTORY), toFils('1039.99'), 'stock at cost after discount');
    assert.equal(booked.get(roles.VAT_INPUT), toFils('52.00'), 'VAT after discount');
    assert.equal(booked.get(roles.ACCOUNTS_PAYABLE), -toFils('1091.99'));
    assert.equal(await onHand(part('A')), 10);
    // A part's cost price is changed only when asked.
    const partA = await prisma.part.findUniqueOrThrow({ where: { id: part('A') } });
    assert.equal(partA.defaultCostPrice?.toString(), '94.1');
  });

  test('the supplier payments: Dr payables, Cr cash; nothing left owed', async () => {
    const payments = await prisma.supplierPayment.findMany({ where: { purchaseId } });
    assert.equal(payments.length, 2);
    const booked = await bookedFor(payments.map((p) => p.id));
    assert.equal(booked.get(roles.ACCOUNTS_PAYABLE), toFils('1091.99'));
    assert.equal(booked.get(roles.CASH), -toFils('1091.99'));
    const payables = await getPayables(a.owner, { supplierId });
    assert.equal(
      payables.rows.find((r) => r.id === purchaseId),
      undefined,
      'settled: off Suppliers owed',
    );
  });

  test('the supplier statement: the bill at its discounted total, both payments, nothing owed', async () => {
    const statement = await getSupplierStatement(a.owner, supplierId);
    const received = statement.lines.filter((line) => line.kind === 'Parts received');
    const billed = received.reduce((sum, line) => sum + toFils(line.credit || '0'), 0);
    assert.equal(billed, toFils('1091.99'));
    const paid = statement.lines
      .filter((line) => line.kind === 'Payment')
      .reduce((sum, line) => sum + toFils(line.debit || '0'), 0);
    assert.equal(paid, toFils('1091.99'));
    assert.equal(statement.closing, '0.00');
  });

  test('the VAT return counts the purchase after discounts, as the books do', async () => {
    const vat = await getVatReturn(a.owner);
    const row = vat.purchases.find((r) => r.id === purchaseId);
    assert.equal(row?.net, '1039.99');
    assert.equal(row?.vat, '52.00');
  });
});

describe('pay later with a due date', () => {
  test('nothing paid, the bill owed, aged from its due date', async () => {
    const { id: supplierId } = await supplier('Pay Later Parts');
    const purchase = await createPurchase(
      a.owner,
      {
        supplierId,
        supplierInvoiceDate: daysAgo(40),
        dueDate: daysAgo(10),
        items: [{ partId: part('E'), quantity: '4', unitCost: '25', taxRate: '5' }],
        payment: 'later',
      },
      { receive: true },
    );
    assert.equal(await prisma.supplierPayment.count({ where: { purchaseId: purchase.id } }), 0);
    const row = (await getPayables(a.owner, { supplierId })).rows.find((r) => r.id === purchase.id);
    assert.equal(row?.balance, '105.00');
    // Ten days past its due date (nine in the small hours, Dubai time, as the calendar
    // date is compared with the moment now — the same rule as every other age).
    assert.ok(row?.daysOverdue === 10 || row?.daysOverdue === 9, String(row?.daysOverdue));
    assert.equal(
      row?.ageDays,
      (row?.daysOverdue ?? 0) + 30,
      'aged from the due date, same buckets',
    );
    const statement = await getSupplierStatement(a.owner, supplierId);
    assert.ok(statement.lines.some((line) => line.description.includes('· due')));
    // A due date can't be before the bill.
    await expectDomainError(
      createPurchase(a.owner, {
        supplierId,
        supplierInvoiceDate: daysAgo(5),
        dueDate: daysAgo(6),
        items: [{ partId: part('E'), quantity: '1', unitCost: '25', taxRate: '5' }],
      }),
      /due date can’t be before/,
    );
  });

  test('paying on receipt needs the right to pay suppliers; pay later does not', async () => {
    const { id: supplierId } = await supplier('Rights Parts');
    const clerk = {
      ...a.owner,
      orgWidePermissions: new Set(
        [...a.owner.orgWidePermissions].filter((code) => code !== 'supplier_payment.create'),
      ),
    };
    const input = {
      supplierId,
      items: [{ partId: part('E'), quantity: '1', unitCost: '25', taxRate: '5' }],
    };
    await assert.rejects(
      createPurchase(clerk, { ...input, payment: 'now', method: 'CASH' }, { receive: true }),
      AuthError,
    );
    const later = await createPurchase(clerk, { ...input, payment: 'later' }, { receive: true });
    assert.equal(
      (await prisma.purchase.findUniqueOrThrow({ where: { id: later.id } })).status,
      'RECEIVED',
    );
    // Paying needs the goods: a draft can't be paid.
    await expectDomainError(
      createPurchase(a.owner, { ...input, payment: 'now', method: 'CASH' }),
      /paid once the goods are received/,
    );
  });
});

describe('a return on a discounted line', () => {
  test('comes off at exactly what those units were booked at', async () => {
    const { id: supplierId } = await supplier('Return Parts');
    // 5 × 20.00 less 10% on the bill: 90.00 + VAT 4.50 = 94.50.
    const purchase = await createPurchase(
      a.owner,
      {
        supplierId,
        items: [{ partId: part('C'), quantity: '5', unitCost: '20', taxRate: '5' }],
        billDiscountType: 'PERCENT',
        billDiscountValue: '10',
      },
      { receive: true },
    );
    const [line] = await itemsOf(purchase.id);
    assert.equal(filsToString(toFils(line.netAmount!.toString())), '90.00');
    // Two go back to the supplier (as a return to supplier would record it).
    await prisma.$transaction(async (tx) => {
      await postMovement(tx, {
        organizationId: a.organizationId,
        branchId: a.branchId,
        partId: part('C'),
        type: 'RETURN_TO_SUPPLIER',
        quantityMilli: -2000,
        unitCost: line.unitCost.toString(),
        purchaseItemId: line.id,
        performedByUserId: a.owner.id,
        note: 'Returned two (test)',
      });
      await tx.purchaseItem.update({ where: { id: line.id }, data: { quantityReceived: '3' } });
    });
    const booked = await bookedForPurchase(purchase.id);
    // 3 of 5 kept: 54.00 + VAT 2.70.
    assert.equal(booked.get(roles.INVENTORY), toFils('54.00'));
    assert.equal(booked.get(roles.VAT_INPUT), toFils('2.70'));
    assert.equal(booked.get(roles.ACCOUNTS_PAYABLE), -toFils('56.70'));
    const row = (await getPayables(a.owner, { supplierId })).rows.find((r) => r.id === purchase.id);
    assert.equal(row?.balance, '56.70', 'the supplier balance agrees with the books');
    const vat = await getVatReturn(a.owner);
    assert.equal(vat.purchases.find((r) => r.id === purchase.id)?.vat, '2.70');
  });
});

describe('a purchase with no discount is exactly as before', () => {
  test('valued, posted, owed, stated and reported by the old formula', async () => {
    const { id: supplierId } = await supplier('Plain Parts');
    const purchase = await createPurchase(a.owner, {
      supplierId,
      items: [{ partId: part('D'), quantity: '3', unitCost: '33.33', taxRate: '5' }],
    });
    const [line] = await itemsOf(purchase.id);
    assert.equal(line.netAmount, null, 'no discount: nothing new stored');
    assert.equal(toFils(line.discountAmount.toString()), 0);
    const header = await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } });
    assert.equal(header.billDiscountType, null);
    // The old totals: 99.99 + VAT 5.00 (4.9995 rounded) = 104.99.
    assert.equal(filsToString(toFils(header.totalAmount!.toString())), '104.99');

    await receivePurchase(a.owner, purchase.id, { [line.id]: '1' });
    await receivePurchase(a.owner, purchase.id, { [line.id]: '2' });
    // The old valuation: each delivery priced on its own quantity.
    const old = (quantity: string) => calculateLine({ quantity, unitPrice: '33.33', taxRate: '5' });
    const one = old('1');
    const two = old('2');
    const booked = await bookedForPurchase(purchase.id);
    assert.equal(booked.get(roles.INVENTORY), one.lineTotalFils + two.lineTotalFils);
    assert.equal(booked.get(roles.VAT_INPUT), one.taxFils + two.taxFils);
    const row = (await getPayables(a.owner, { supplierId })).rows.find((r) => r.id === purchase.id);
    // The old balance: everything received, priced together.
    const whole = old('3');
    assert.equal(row?.received, filsToString(whole.lineTotalFils + whole.taxFils));
    assert.equal(row?.dueDate, null);
    const statement = await getSupplierStatement(a.owner, supplierId);
    const billed = statement.lines
      .filter((l) => l.kind === 'Parts received')
      .reduce((sum, l) => sum + toFils(l.credit || '0'), 0);
    assert.equal(billed, one.lineTotalFils + one.taxFils + two.lineTotalFils + two.taxFils);
    assert.ok(!statement.lines.some((l) => l.description.includes('· due')));
    const vat = await getVatReturn(a.owner);
    const vatRow = vat.purchases.find((r) => r.id === purchase.id);
    assert.equal(vatRow?.vat, filsToString(one.taxFils + two.taxFils));
  });
});

describe('everything agrees', () => {
  test('no income from discounts; the balance sheet balances; nothing unbooked', async () => {
    const pnl = await getLedgerProfitAndLoss(a.owner);
    assert.equal(pnl.income.total, '0.00', 'a purchase discount is never income');
    assert.equal(pnl.netProfit, '0.00', 'buying stock is not an expense');
    // Trade payables equals what Suppliers owed shows, across every supplier.
    const owedFils = (await getPayables(a.owner)).totals.balanceFils;
    assert.equal(-(await balanceOf(roles.ACCOUNTS_PAYABLE)), owedFils);
    assert.equal((await getBalanceSheet(a.owner)).balanced, true);
    assert.equal(await countUnbooked(a.owner), 0);
  });
});
