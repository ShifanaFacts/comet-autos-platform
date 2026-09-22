/**
 * Integration tests for paying suppliers.
 *
 * The rule that matters most: the balance a payment is checked against and
 * the balance every screen shows are the same figure, computed once in
 * `lib/finance/supplier-balance`. These tests pin that down from both ends —
 * pay against the payables screen's number, then read it back from the
 * supplier directory and the outstanding screen and require agreement.
 *
 *   npm run test:integration
 */
import 'dotenv/config';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/lib/prisma';
import { AuthError } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { toLocalDateTimeInput } from '@/lib/format';
import { createSupplier, listSuppliers } from '@/lib/inventory/suppliers';
import { createPurchase, receivePurchase } from '@/lib/inventory/purchases';
import { getSupplierOutstanding } from '@/lib/finance/outstanding';
import { supplierPaidFils } from '@/lib/finance/supplier-balance';
import {
  getPayables,
  getPurchaseForPayment,
  getSupplierPayables,
  listSupplierPayments,
  recordSupplierPayment,
  reverseSupplierPayment,
} from '@/lib/finance/supplier-payments';
import { createTestOrg, expectDomainError, RUN, type TestOrg } from './support';

let a: TestOrg;
let b: TestOrg;
let supplierId: string;
let purchaseId: string;
/** The received value of that purchase — what is owed before any payment. */
let owed: string;
let firstPaymentId: string;

const now = () => toLocalDateTimeInput(new Date());

/** What the payables screen says is still owed on our purchase. */
async function payableBalance(org: TestOrg = a, id = purchaseId) {
  const { rows } = await getPayables(org.owner);
  return rows.find((row) => row.id === id)?.balance ?? '0.00';
}

before(async () => {
  a = await createTestOrg('PayA', [
    { sku: `FLT-${RUN}`, name: 'Oil filter', cost: '12.50', price: '25.00', stock: '0' },
  ]);
  b = await createTestOrg('PayB', [
    { sku: `FLT2-${RUN}`, name: 'Oil filter', cost: '12.50', price: '25.00', stock: '0' },
  ]);

  const supplier = await createSupplier(a.owner, {
    name: `Gulf Auto Parts ${RUN}`,
    phone: '04 222 3333',
  });
  supplierId = supplier.id;

  const purchase = await createPurchase(a.owner, {
    supplierId,
    supplierInvoiceNumber: `GAP-${RUN}`,
    items: [{ partId: a.parts[`FLT-${RUN}`].id, quantity: '10', unitCost: '12.50', taxRate: '5' }],
  });
  purchaseId = purchase.id;
  // 10 × 12.50 = 125.00 net, 5% VAT = 6.25, so 131.25 is owed once received.
  const line = await prisma.purchaseItem.findFirstOrThrow({
    where: { purchaseId },
    select: { id: true },
  });
  await receivePurchase(a.owner, purchaseId, { [line.id]: '10' });
  owed = await payableBalance();
});

after(async () => {
  await prisma.$disconnect();
});

describe('what is owed', () => {
  test('a received purchase owes cost plus VAT, and every screen agrees', async () => {
    assert.equal(owed, '131.25', '10 × 12.50 = 125.00 plus 5% VAT');

    const payables = await getPayables(a.owner);
    const row = payables.rows.find((r) => r.id === purchaseId);
    assert.ok(row);
    assert.equal(row.received, '131.25');
    assert.equal(row.paid, '0.00');
    assert.equal(row.state, 'UNPAID');

    // The outstanding screen and the supplier directory must not disagree.
    const outstanding = await getSupplierOutstanding(a.owner);
    assert.equal(outstanding.rows.find((r) => r.id === purchaseId)?.balance, '131.25');
    const directory = await listSuppliers(a.owner, `Gulf Auto Parts ${RUN}`);
    assert.equal(directory[0]?.balance.outstanding, '131.25');
    const detail = await getSupplierPayables(a.owner, supplierId);
    assert.equal(detail.totals.balance, '131.25');
  });

  test('the payables overview totals and groups by supplier', async () => {
    const payables = await getPayables(a.owner);
    assert.ok(payables.totals.suppliers >= 1);
    assert.ok(payables.suppliers.some((s) => s.id === supplierId));
    assert.equal(typeof payables.totals.overdue, 'string');
    assert.ok(payables.totals.ageing.current.length > 0);
  });

  test('a draft purchase owes nothing — only what was received', async () => {
    const draft = await createPurchase(a.owner, {
      supplierId,
      items: [{ partId: a.parts[`FLT-${RUN}`].id, quantity: '5', unitCost: '10.00' }],
    });
    const payables = await getPayables(a.owner);
    assert.ok(
      !payables.rows.some((row) => row.id === draft.id),
      'nothing is owed until the goods arrive',
    );
    await expectDomainError(
      recordSupplierPayment(a.owner, draft.id, {
        amount: '10.00',
        method: 'CASH',
        paidAt: now(),
        requestKey: `pay-draft-${RUN}`,
      }),
      /has been received can be paid/i,
    );
  });
});

describe('recording a payment', () => {
  test('a partial payment leaves the right balance, numbered and audited', async () => {
    const result = await recordSupplierPayment(a.owner, purchaseId, {
      amount: '50.00',
      method: 'BANK_TRANSFER',
      paidAt: now(),
      referenceNumber: 'TT-99001',
      requestKey: `pay-partial-${RUN}`,
    });
    firstPaymentId = result.id;
    assert.equal(result.amount, '50.00');
    assert.equal(result.balanceAfter, '81.25', '131.25 − 50.00');
    assert.equal(result.fullySettled, false);
    assert.match(result.supplierPaymentNumber, /^SP-\d{6}$/);

    assert.equal(await payableBalance(), '81.25');
    const detail = await getSupplierPayables(a.owner, supplierId);
    assert.equal(detail.totals.paid, '50.00');
    assert.equal(detail.totals.balance, '81.25');
    assert.equal(detail.purchases.find((p) => p.id === purchaseId)?.state, 'PARTIALLY_PAID');

    // And the other two screens still agree.
    const outstanding = await getSupplierOutstanding(a.owner);
    assert.equal(outstanding.rows.find((r) => r.id === purchaseId)?.balance, '81.25');
    const directory = await listSuppliers(a.owner, `Gulf Auto Parts ${RUN}`);
    assert.equal(directory[0]?.balance.outstanding, '81.25');

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: result.id, action: 'supplier_payment.recorded' },
      select: { afterData: true },
    });
    assert.ok(audit, 'the payment is audited');
    assert.match(JSON.stringify(audit.afterData), /"balanceAfter":"81\.25"/);
  });

  test('exact money: thirds of a fil never drift', async () => {
    const odd = await createPurchase(a.owner, {
      supplierId,
      items: [{ partId: a.parts[`FLT-${RUN}`].id, quantity: '3', unitCost: '33.33', taxRate: '5' }],
    });
    const line = await prisma.purchaseItem.findFirstOrThrow({
      where: { purchaseId: odd.id },
      select: { id: true },
    });
    await receivePurchase(a.owner, odd.id, { [line.id]: '3' });
    // 3 × 33.33 = 99.99, VAT 5% = 4.9995 → 5.00, total 104.99
    const before = await getPurchaseForPayment(a.owner, odd.id);
    assert.equal(before.balance, '104.99');

    // Three payments that must sum exactly, leaving nothing behind.
    for (const [index, amount] of ['34.99', '35.00', '35.00'].entries()) {
      await recordSupplierPayment(a.owner, odd.id, {
        amount,
        method: 'CASH',
        paidAt: now(),
        requestKey: `pay-odd-${index}-${RUN}`,
      });
    }
    const after = await getPurchaseForPayment(a.owner, odd.id);
    assert.equal(after.balance, '0.00', 'settled to the fil');
    assert.equal(after.paid, '104.99');
    assert.equal(after.state, 'PAID');
    assert.ok(
      !(await getPayables(a.owner)).rows.some((row) => row.id === odd.id),
      'a settled purchase leaves the payables list',
    );
  });

  test('overpayment is refused, to the fil', async () => {
    const balance = await payableBalance();
    assert.equal(balance, '81.25');
    await expectDomainError(
      recordSupplierPayment(a.owner, purchaseId, {
        amount: '81.26',
        method: 'CASH',
        paidAt: now(),
        requestKey: `pay-over-${RUN}`,
      }),
      /more than the 81\.25 still owed/i,
    );
    assert.equal(await payableBalance(), '81.25', 'and nothing was recorded');
  });

  test('zero, negative and malformed amounts are refused', async () => {
    for (const amount of ['0', '0.00', '-10.00', 'ten', '10.005']) {
      await expectDomainError(
        recordSupplierPayment(a.owner, purchaseId, {
          amount,
          method: 'CASH',
          paidAt: now(),
          requestKey: `pay-bad-${amount}-${RUN}`,
        }),
        /amount like|greater than zero/i,
      );
    }
    assert.equal(await payableBalance(), '81.25');
  });

  test('a payment cannot be dated in the future, or before the goods arrived', async () => {
    await expectDomainError(
      recordSupplierPayment(a.owner, purchaseId, {
        amount: '10.00',
        method: 'CASH',
        paidAt: toLocalDateTimeInput(new Date(Date.now() + 3 * 86_400_000)),
        requestKey: `pay-future-${RUN}`,
      }),
      /dated in the future/i,
    );
    await expectDomainError(
      recordSupplierPayment(a.owner, purchaseId, {
        amount: '10.00',
        method: 'CASH',
        paidAt: toLocalDateTimeInput(new Date(Date.now() - 30 * 86_400_000)),
        requestKey: `pay-early-${RUN}`,
      }),
      /before the goods were received/i,
    );
    await expectDomainError(
      recordSupplierPayment(a.owner, purchaseId, {
        amount: '10.00',
        method: 'CASH',
        paidAt: 'not-a-date',
        requestKey: `pay-nodate-${RUN}`,
      }),
      /valid date/i,
    );
  });

  test('a full settlement closes the balance and leaves the list', async () => {
    const result = await recordSupplierPayment(a.owner, purchaseId, {
      amount: '81.25',
      method: 'CHEQUE',
      paidAt: now(),
      referenceNumber: 'CHQ-4410',
      requestKey: `pay-settle-${RUN}`,
    });
    assert.equal(result.balanceAfter, '0.00');
    assert.equal(result.fullySettled, true);
    assert.equal(await payableBalance(), '0.00');

    const detail = await getSupplierPayables(a.owner, supplierId);
    assert.equal(detail.purchases.find((p) => p.id === purchaseId)?.state, 'PAID');
    assert.ok(!detail.owing.some((row) => row.id === purchaseId));

    await expectDomainError(
      recordSupplierPayment(a.owner, purchaseId, {
        amount: '1.00',
        method: 'CASH',
        paidAt: now(),
        requestKey: `pay-again-${RUN}`,
      }),
      /already fully paid/i,
    );
  });

  test('the same submission twice pays once', async () => {
    const fresh = await createPurchase(a.owner, {
      supplierId,
      items: [{ partId: a.parts[`FLT-${RUN}`].id, quantity: '2', unitCost: '20.00', taxRate: '5' }],
    });
    const line = await prisma.purchaseItem.findFirstOrThrow({
      where: { purchaseId: fresh.id },
      select: { id: true },
    });
    await receivePurchase(a.owner, fresh.id, { [line.id]: '2' });

    const input = {
      amount: '10.00',
      method: 'CASH' as const,
      paidAt: now(),
      requestKey: `pay-double-submit-${RUN}`,
    };
    const results = await Promise.allSettled([
      recordSupplierPayment(a.owner, fresh.id, input),
      recordSupplierPayment(a.owner, fresh.id, input),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      await prisma.supplierPayment.count({ where: { purchaseId: fresh.id } }),
      1,
      'exactly one payment row',
    );
    const after = await getPurchaseForPayment(a.owner, fresh.id);
    assert.equal(after.paid, '10.00', 'and the money was only counted once');

    // A refused attempt must not block a corrected retry.
    await expectDomainError(
      recordSupplierPayment(a.owner, fresh.id, {
        amount: '999.00',
        method: 'CASH',
        paidAt: now(),
        requestKey: `pay-retry-${RUN}`,
      }),
      /more than the/i,
    );
    const corrected = await recordSupplierPayment(a.owner, fresh.id, {
      amount: '5.00',
      method: 'CASH',
      paidAt: now(),
      requestKey: `pay-retry-corrected-${RUN}`,
    });
    assert.equal(corrected.amount, '5.00');
  });

  test('two payments racing each other cannot overpay', async () => {
    const fresh = await createPurchase(a.owner, {
      supplierId,
      items: [{ partId: a.parts[`FLT-${RUN}`].id, quantity: '1', unitCost: '100.00', taxRate: '0' }],
    });
    const line = await prisma.purchaseItem.findFirstOrThrow({
      where: { purchaseId: fresh.id },
      select: { id: true },
    });
    await receivePurchase(a.owner, fresh.id, { [line.id]: '1' });

    // Two different submissions, each for the whole balance, at once.
    const results = await Promise.allSettled([
      recordSupplierPayment(a.owner, fresh.id, {
        amount: '100.00',
        method: 'CASH',
        paidAt: now(),
        requestKey: `pay-race-1-${RUN}`,
      }),
      recordSupplierPayment(a.owner, fresh.id, {
        amount: '100.00',
        method: 'CARD',
        paidAt: now(),
        requestKey: `pay-race-2-${RUN}`,
      }),
    ]);
    assert.equal(
      results.filter((r) => r.status === 'fulfilled').length,
      1,
      'the second is refused, not queued behind a stale balance',
    );
    const after = await getPurchaseForPayment(a.owner, fresh.id);
    assert.equal(after.paid, '100.00');
    assert.equal(after.balance, '0.00');
  });
});

describe('reversal', () => {
  test('a reversal puts the money back and keeps both rows', async () => {
    const before = await getPurchaseForPayment(a.owner, purchaseId);
    assert.equal(before.balance, '0.00');

    const reversal = await reverseSupplierPayment(a.owner, firstPaymentId, {
      reason: 'Paid the wrong supplier invoice',
      requestKey: `pay-reverse-${RUN}`,
    });
    const after = await getPurchaseForPayment(a.owner, purchaseId);
    assert.equal(after.balance, '50.00', 'the reversed 50.00 is owed again');
    assert.equal(after.paid, '81.25');

    // Nothing was deleted.
    const original = await prisma.supplierPayment.findUniqueOrThrow({
      where: { id: firstPaymentId },
      select: { status: true, amount: true },
    });
    assert.equal(original.status, 'REVERSED');
    assert.equal(original.amount.toString(), '50');
    assert.ok(await prisma.supplierPayment.findUnique({ where: { id: reversal.id } }));

    assert.ok(
      await prisma.auditLog.findFirst({
        where: { entityId: firstPaymentId, action: 'supplier_payment.reversed' },
      }),
    );
    // And it is back on the payables list.
    assert.equal(await payableBalance(), '50.00');
  });

  test('a reversal cannot be reversed, or repeated', async () => {
    await expectDomainError(
      reverseSupplierPayment(a.owner, firstPaymentId, {
        reason: 'Again',
        requestKey: `pay-rereverse-${RUN}`,
      }),
      /already been reversed/i,
    );
    const reversalRow = await prisma.supplierPayment.findFirstOrThrow({
      where: { reversalOfSupplierPaymentId: firstPaymentId },
      select: { id: true },
    });
    await expectDomainError(
      reverseSupplierPayment(a.owner, reversalRow.id, {
        reason: 'Nope',
        requestKey: `pay-reverse-reversal-${RUN}`,
      }),
      /itself a reversal/i,
    );
  });

  test('the shared rule drops both rows of a reversed pair', () => {
    const paid = supplierPaidFils([
      { id: 'p1', amount: '50.00', status: 'REVERSED', reversalOfSupplierPaymentId: null },
      { id: 'r1', amount: '50.00', status: 'REVERSED', reversalOfSupplierPaymentId: 'p1' },
      { id: 'p2', amount: '25.00', status: 'COMPLETED', reversalOfSupplierPaymentId: null },
    ]);
    assert.equal(paid, 2500, 'only the untouched 25.00 counts');
  });
});

describe('history', () => {
  test('payments list with everything needed to check one', async () => {
    const payments = await listSupplierPayments(a.owner, { supplierId });
    assert.ok(payments.length >= 3);
    const settled = payments.find((p) => p.referenceNumber === 'CHQ-4410');
    assert.ok(settled);
    assert.equal(settled.amount, '81.25');
    assert.equal(settled.method, 'CHEQUE');
    assert.equal(settled.status, 'COMPLETED');
    assert.equal(settled.purchase.supplier.id, supplierId);
    assert.ok(settled.paidBy?.fullName, 'who recorded it');
    assert.ok(settled.supplierPaymentNumber?.startsWith('SP-'));

    const reversed = payments.find((p) => p.id === firstPaymentId);
    assert.equal(reversed?.wasReversed, true);
    assert.ok(payments.some((p) => p.isReversal));

    const bySearch = await listSupplierPayments(a.owner, { q: 'CHQ-4410' });
    assert.equal(bySearch.length, 1);
    const byPurchase = await listSupplierPayments(a.owner, { purchaseId });
    assert.ok(byPurchase.every((p) => p.purchase.id === purchaseId));
  });

  test('the overview carries the latest payments', async () => {
    const payables = await getPayables(a.owner);
    assert.ok(payables.recentPayments.length > 0);
    assert.ok(payables.recentPayments.length <= 8, 'bounded');
  });
});

describe('security', () => {
  test('reading needs inventory.view; recording needs accounting.create', async () => {
    // Someone with no stock rights at all cannot even look.
    const outsider = { ...a.owner, orgWidePermissions: new Set(['job_card.view']) };
    await assert.rejects(getPayables(outsider), (e: unknown) => e instanceof AuthError);
    await assert.rejects(
      getSupplierPayables(outsider, supplierId),
      (e: unknown) => e instanceof AuthError,
    );
    await assert.rejects(
      listSupplierPayments(outsider),
      (e: unknown) => e instanceof AuthError,
    );

    // The stock viewer may look — reading payables is the same right as
    // reading supplier outstanding today — but may not move money.
    assert.ok(await getPayables(a.viewer));
    await assert.rejects(
      recordSupplierPayment(a.viewer, purchaseId, {
        amount: '1.00',
        method: 'CASH',
        paidAt: now(),
        requestKey: `pay-viewer-${RUN}`,
      }),
      (e: unknown) => e instanceof AuthError,
    );

    // Someone who can see stock but not move money.
    const stockOnly = { ...a.owner, orgWidePermissions: new Set(['inventory.view']) };
    assert.ok(await getPayables(stockOnly), 'they can look');
    await assert.rejects(
      recordSupplierPayment(stockOnly, purchaseId, {
        amount: '1.00',
        method: 'CASH',
        paidAt: now(),
        requestKey: `pay-noperm-${RUN}`,
      }),
      (e: unknown) => e instanceof AuthError,
      'but not pay',
    );
    await assert.rejects(
      reverseSupplierPayment(stockOnly, firstPaymentId, {
        reason: 'No rights',
        requestKey: `pay-noperm-rev-${RUN}`,
      }),
      (e: unknown) => e instanceof AuthError,
    );

    // Recording is not reversing.
    const recorder = { ...a.owner, orgWidePermissions: new Set(['accounting.create']) };
    await assert.rejects(
      reverseSupplierPayment(recorder, firstPaymentId, {
        reason: 'Still no',
        requestKey: `pay-recorder-rev-${RUN}`,
      }),
      (e: unknown) => e instanceof AuthError,
    );
  });

  test('one workshop cannot see or pay another’s purchases', async () => {
    await assert.rejects(
      getPurchaseForPayment(b.owner, purchaseId),
      (e: unknown) => e instanceof NotFoundError,
      'another workshop gets "not found", never the purchase',
    );
    await assert.rejects(
      recordSupplierPayment(b.owner, purchaseId, {
        amount: '10.00',
        method: 'CASH',
        paidAt: now(),
        requestKey: `pay-crossorg-${RUN}`,
      }),
      (e: unknown) => e instanceof NotFoundError,
    );
    await assert.rejects(
      reverseSupplierPayment(b.owner, firstPaymentId, {
        reason: 'Not mine',
        requestKey: `pay-crossorg-rev-${RUN}`,
      }),
      (e: unknown) => e instanceof NotFoundError,
    );
    await assert.rejects(
      getSupplierPayables(b.owner, supplierId),
      (e: unknown) => e instanceof NotFoundError,
    );

    const theirs = await getPayables(b.owner);
    assert.ok(
      !theirs.rows.some((row) => row.id === purchaseId),
      'and nothing of ours appears in their list',
    );
    assert.equal(
      (await listSupplierPayments(b.owner)).filter((p) => p.id === firstPaymentId).length,
      0,
    );
    // Ours is untouched by all of that.
    assert.equal(await payableBalance(), '50.00');
  });

  test('a branch-scoped user only sees and pays their own branch', async () => {
    const otherBranch = await prisma.branch.create({
      data: {
        organizationId: a.organizationId,
        code: `B2${RUN.slice(-3)}`,
        name: 'Second bay',
      },
      select: { id: true },
    });
    const elsewhere = { ...a.owner, primaryBranchId: otherBranch.id };

    const payables = await getPayables(elsewhere);
    assert.ok(
      !payables.rows.some((row) => row.id === purchaseId),
      'another branch’s bills are not theirs to see',
    );
    await assert.rejects(
      getPurchaseForPayment(elsewhere, purchaseId),
      (e: unknown) => e instanceof NotFoundError,
    );
    await assert.rejects(
      recordSupplierPayment(elsewhere, purchaseId, {
        amount: '10.00',
        method: 'CASH',
        paidAt: now(),
        requestKey: `pay-crossbranch-${RUN}`,
      }),
      (e: unknown) => e instanceof NotFoundError,
    );
    assert.equal(
      (await listSupplierPayments(elsewhere)).filter((p) => p.purchase.id === purchaseId).length,
      0,
    );
    assert.equal(await payableBalance(), '50.00', 'and ours is untouched');
  });
});
