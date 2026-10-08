/**
 * Integration tests for taking money:
 *
 *  - a sales receipt: an invoice issued and paid on the spot, in one step,
 *    under the same payment rules as any other payment;
 *  - a payment entered wrongly and reversed, then entered again: the
 *    payments list shows only the money that stands, the reversed payment
 *    is found under Reversed with its reason, the export keeps every row
 *    (reversals negative, adding up to what was received), and the
 *    reversed receipt says so.
 *
 *   npm run test:integration
 */
import 'dotenv/config';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/lib/prisma';
import { createDirectInvoice } from '@/lib/billing/direct-invoice';
import { recordInvoicePayment } from '@/lib/billing/invoice';
import { reverseInvoicePayment } from '@/lib/billing/invoice-changes';
import { listPayments } from '@/lib/billing/lists';
import { getReceiptDocument } from '@/lib/documents/build';
import { NotFoundError } from '@/lib/errors';
import { toFils } from '@/lib/money';
import { toLocalDateTimeInput } from '@/lib/format';
import { createTestOrg, expectDomainError, RUN, type TestOrg } from './support';

const money = (value: { toString(): string } | null | undefined) =>
  Number(value?.toString() ?? 'NaN').toFixed(2);

let a: TestOrg;

before(async () => {
  a = await createTestOrg('Receipts', [
    { sku: 'RC-FUSE', name: 'Fuse', cost: '2', price: '5', stock: '10' },
  ]);
});

after(async () => {
  await prisma.$disconnect();
});

const fuse = () => a.parts['RC-FUSE'].id;

async function customer(suffix: string) {
  return prisma.customer.create({
    data: {
      organizationId: a.organizationId,
      name: `Receipt Customer ${suffix} ${RUN}`,
      phone: `050 ${suffix.padStart(3, '0')} 5533`,
    },
  });
}

describe('a sales receipt', () => {
  test('issues the invoice and records its whole total as received', async () => {
    const { id: customerId } = await customer('10');
    const result = await createDirectInvoice(a.owner, {
      customerId,
      items: [{ itemType: 'LABOUR', description: 'Car wash', quantity: '1', unitPrice: '40' }],
      payNow: '1',
      paymentMethod: 'CARD',
      paymentReference: 'SLIP 0042',
    });
    assert.ok(result.paymentId, 'a payment was taken');

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: result.invoiceId },
      include: { payments: true },
    });
    assert.equal(invoice.status, 'PAID');
    assert.equal(invoice.payments.length, 1);
    assert.equal(money(invoice.payments[0].amount), '42.00');
    assert.equal(invoice.payments[0].method, 'CARD');
    assert.equal(invoice.payments[0].referenceNumber, 'SLIP 0042');
    assert.match(invoice.payments[0].paymentNumber ?? '', /^RCT-/);

    const receipt = await getReceiptDocument(a.owner, result.paymentId!);
    assert.equal(receipt.title, 'Payment receipt');
    assert.equal(receipt.status?.label, 'Paid in full');
  });

  test('needs to know how the customer paid', async () => {
    const { id: customerId } = await customer('11');
    await expectDomainError(
      createDirectInvoice(a.owner, {
        customerId,
        items: [
          { itemType: 'PART', description: 'Fuse', quantity: '1', unitPrice: '5', partId: fuse() },
        ],
        payNow: '1',
      }),
      /how the customer paid/,
    );
  });

  test('without it, the invoice waits for payment as before', async () => {
    const { id: customerId } = await customer('12');
    const result = await createDirectInvoice(a.owner, {
      customerId,
      items: [
        { itemType: 'PART', description: 'Fuse', quantity: '1', unitPrice: '5', partId: fuse() },
      ],
    });
    assert.equal(result.paymentId, null);
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: result.invoiceId } });
    assert.equal(invoice.status, 'ISSUED');
  });
});

describe('a payment entered wrongly, reversed and entered again', () => {
  test('lists only the money that stands, and keeps the rest on record', async () => {
    const { id: customerId } = await customer('20');
    // 219.00 + 5% VAT = 229.95, the case that came up in the workshop.
    const { invoiceId, invoiceNumber } = await createDirectInvoice(a.owner, {
      customerId,
      items: [{ itemType: 'LABOUR', description: 'Service', quantity: '1', unitPrice: '219' }],
    });
    const now = toLocalDateTimeInput(new Date());
    const wrong = await recordInvoicePayment(a.owner, invoiceId, {
      amount: '229',
      method: 'CASH',
      receivedAt: now,
    });
    await reverseInvoicePayment(a.owner, wrong.id, { reason: 'Typed 229 instead of 229.95' });
    const right = await recordInvoicePayment(a.owner, invoiceId, {
      amount: '229.95',
      method: 'CASH',
      receivedAt: now,
    });

    // Received: the one payment that stands.
    const received = await listPayments(a.owner, { q: invoiceNumber });
    assert.deepEqual(
      received.payments.map((p) => p.id),
      [right.id],
    );
    assert.equal(received.totalShown, toFils('229.95'));

    // Reversed: the wrong one, with when and why.
    const reversed = await listPayments(a.owner, { q: invoiceNumber, view: 'reversed' });
    assert.equal(reversed.payments.length, 1);
    assert.equal(reversed.payments[0].id, wrong.id);
    assert.equal(reversed.payments[0].standing, 'REVERSED');
    assert.equal(reversed.payments[0].reversal?.notes, 'Typed 229 instead of 229.95');
    assert.equal(reversed.totalReversed, toFils('229.00'));

    // Everything, for the export: three rows whose signed amounts add up to
    // what was actually received.
    const all = await listPayments(a.owner, { q: invoiceNumber, view: 'all' });
    assert.equal(all.payments.length, 3);
    assert.deepEqual(all.payments.map((p) => p.standing).sort(), [
      'RECEIVED',
      'REVERSAL',
      'REVERSED',
    ]);
    assert.equal(
      all.payments.reduce(
        (sum, p) =>
          sum +
          (p.signedAmount.startsWith('-')
            ? -toFils(p.signedAmount.slice(1))
            : toFils(p.signedAmount)),
        0,
      ),
      toFils('229.95'),
    );

    // The reversed receipt says so; the reversal row has no receipt at all.
    const receipt = await getReceiptDocument(a.owner, wrong.id);
    assert.equal(receipt.status?.label, 'Reversed');
    assert.match(receipt.title, /reversed/);
    assert.ok(receipt.details.some((d) => d.label === 'Reason'));
    const reversalRow = all.payments.find((p) => p.standing === 'REVERSAL')!;
    await assert.rejects(getReceiptDocument(a.owner, reversalRow.id), NotFoundError);

    // Nothing was deleted or edited: the original keeps its amount.
    const original = await prisma.payment.findUniqueOrThrow({ where: { id: wrong.id } });
    assert.equal(money(original.amount), '229.00');
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    assert.equal(invoice.status, 'PAID');
  });
});
