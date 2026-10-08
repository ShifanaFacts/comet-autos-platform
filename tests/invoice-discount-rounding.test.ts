/**
 * Integration tests for a discount given after an invoice, and an invoice's
 * round-off:
 *
 *  - "the customer paid 154.00 less": the 154.00 given as a discount is a
 *    tax credit note — 146.67 + VAT 7.33 — spread across the lines to the
 *    fil; the sale and output VAT come down, nothing is refunded, and the
 *    invoice is settled; never more than is still due;
 *  - on a job card's invoice, the discount that settles it moves the job
 *    card to Paid, and voiding it puts both back: owed again, Invoiced;
 *  - 154.00 off the total as a discount, not a credit note (the INV-000009
 *    correction): the invoice keeps 3,654 and VAT 174, the discount is its
 *    own entry (Dr Sales discounts, Cr receivables), paid, job Paid; shown
 *    under the total on the invoice and on the statement; taken off again,
 *    owed 154.00 and Invoiced;
 *  - a round-off after VAT, outside VAT, booked to Rounding adjustments; at
 *    most 5.00; editable while the invoice is unpaid;
 *  - the credit note that credits the last of the lines takes the round-off
 *    back, so a fully credited invoice owes, and refunds, exactly its total;
 *  - the books balance and nothing is left unbooked.
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
import { ensureChart } from '@/lib/accounting/chart';
import { bookExistingRecords, countUnbooked } from '@/lib/accounting/entries';
import { getBalanceSheet } from '@/lib/accounting/reports';
import { createDirectInvoice } from '@/lib/billing/direct-invoice';
import { getInvoiceDetail, recordInvoicePayment } from '@/lib/billing/invoice';
import {
  addBillDiscount,
  discountInvoice,
  invoiceEditBlocker,
  removeBillDiscount,
  removeInvoiceDiscount,
  updateInvoice,
} from '@/lib/billing/invoice-changes';
import { getCustomerStatement } from '@/lib/finance/statements';
import { getInvoiceDocument } from '@/lib/documents/build';
import {
  createCreditNote,
  createDiscountCreditNote,
  getCreditableInvoice,
  voidCreditNote,
} from '@/lib/billing/credit-notes';
import { checkInVehicle } from '@/lib/workshop/check-in';
import { toFils } from '@/lib/money';
import { toLocalDateTimeInput } from '@/lib/format';
import { createTestOrg, expectDomainError, RUN, type TestOrg } from './support';

let a: TestOrg;
let roles: Record<AccountRole, string>;
let customerId: string;

/** The parts sold below, each in stock: an invoice's Parts line names its part. */
const PART_NAMES = [
  'Parts',
  'Tensioner assy V-belt',
  'Boot steering',
  'Oil seal rear main',
  'Oil seal torque converter',
  'Oil seal crank front',
  'Fluid power steering',
  'Coolant',
  'Rear lower arm boots',
  'Front upper and lower boots',
];
const partId = (name: string) => a.parts[`ID-${PART_NAMES.indexOf(name)}`].id;

before(async () => {
  a = await createTestOrg(
    'Invoice discount',
    PART_NAMES.map((name, index) => ({
      sku: `ID-${index}`,
      name,
      cost: '10',
      price: '20',
      stock: '10',
    })),
  );
  roles = await prisma.$transaction((tx) => ensureChart(tx, a.organizationId));
  // Their opening stock, in the books before any is sold.
  await bookExistingRecords(a.owner);
  customerId = (
    await prisma.customer.create({
      data: { organizationId: a.organizationId, name: `Shaloop ${RUN}`, phone: '050 444 1122' },
    })
  ).id;
});

after(async () => {
  await prisma.$disconnect();
});

const now = () => toLocalDateTimeInput(new Date());

/** Net debit per account, in fils, over the entries booking these records. */
async function bookedFor(...sourceIds: string[]) {
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

describe('the customer paid 154.00 less', () => {
  let invoiceId: string;

  before(async () => {
    // Labour 1,480 + parts 2,000 = 3,480; VAT 174; total 3,654 — as INV-000009.
    ({ invoiceId } = await createDirectInvoice(a.owner, {
      customerId,
      items: [
        { itemType: 'LABOUR', description: 'Service', quantity: '1', unitPrice: '1480' },
        {
          itemType: 'PART',
          description: 'Parts',
          quantity: '1',
          unitPrice: '2000',
          partId: partId('Parts'),
        },
      ],
    }));
    await recordInvoicePayment(a.owner, invoiceId, {
      amount: '3500',
      method: 'CASH',
      receivedAt: now(),
    });
    assert.equal((await getInvoiceDetail(a.owner, invoiceId)).balanceDue, '154.00');
  });

  test('never more than is still due', async () => {
    await expectDomainError(
      createDiscountCreditNote(a.owner, invoiceId, { amount: '154.01' }),
      /Only 154\.00 is still due/,
    );
  });

  test('given as a tax credit note: 146.67 + VAT 7.33, nothing refunded, invoice settled', async () => {
    const note = await createDiscountCreditNote(a.owner, invoiceId, { amount: '154' });
    assert.equal(note.totalAmount, '154.00');
    assert.equal(note.refundAmount, '0.00', 'the customer already paid less');
    const row = await prisma.creditNote.findUniqueOrThrow({ where: { id: note.creditNoteId } });
    assert.equal(row.taxAmount.toString(), '7.33');
    assert.equal(row.subtotal.toString(), '146.67');
    assert.equal(row.reason, 'Discount given at payment');
    const detail = await getInvoiceDetail(a.owner, invoiceId);
    assert.equal(detail.balanceDue, '0.00');
    assert.equal(detail.status, 'PAID');
    // The books: VAT and sales down, receivable cleared.
    const booked = await bookedFor(note.creditNoteId);
    assert.equal(booked.get(roles.VAT_OUTPUT), toFils('7.33'));
    assert.equal(booked.get(roles.ACCOUNTS_RECEIVABLE), -toFils('154.00'));
    const sales = (booked.get(roles.SALES_LABOUR) ?? 0) + (booked.get(roles.SALES_PARTS) ?? 0);
    assert.equal(sales, toFils('146.67'));
  });
});

describe('the discount that settles a job card’s invoice', () => {
  let jobCardId: string;
  let invoiceId: string;
  let creditNoteId: string;

  const jobStatus = async () =>
    (await prisma.jobCard.findUniqueOrThrow({ where: { id: jobCardId } })).status;

  before(async () => {
    const vehicleId = (
      await prisma.vehicle.create({
        data: {
          organizationId: a.organizationId,
          customerId,
          plateNumber: `J ${RUN.slice(-5)}`,
          make: 'Toyota',
          model: 'Land Cruiser',
        },
      })
    ).id;
    ({ jobCardId } = await checkInVehicle(a.owner, {
      mode: 'existing',
      vehicleId,
      visit: { complaint: 'Service' },
    }));
    // 3,654 on the job card, 3,500 paid — as INV-000009 on JC-000008.
    ({ invoiceId } = await createDirectInvoice(a.owner, {
      customerId,
      jobCardId,
      items: [
        { itemType: 'LABOUR', description: 'Service', quantity: '1', unitPrice: '1480' },
        {
          itemType: 'PART',
          description: 'Parts',
          quantity: '1',
          unitPrice: '2000',
          partId: partId('Parts'),
        },
      ],
    }));
    assert.equal(await jobStatus(), 'INVOICED');
    await recordInvoicePayment(a.owner, invoiceId, {
      amount: '3500',
      method: 'CASH',
      receivedAt: now(),
    });
    const detail = await getInvoiceDetail(a.owner, invoiceId);
    assert.equal(detail.totalAmount.toString(), '3654');
    assert.equal(detail.balanceDue, '154.00');
    assert.equal(detail.status, 'PARTIALLY_PAID');
    assert.equal(await jobStatus(), 'INVOICED', 'not paid in full yet');
  });

  test('154.00 discount: invoice settled, job card Paid, nothing refunded', async () => {
    const note = await createDiscountCreditNote(a.owner, invoiceId, { amount: '154' });
    creditNoteId = note.creditNoteId;
    assert.equal(note.totalAmount, '154.00');
    assert.equal(note.refundAmount, '0.00');
    const detail = await getInvoiceDetail(a.owner, invoiceId);
    assert.equal(detail.balanceDue, '0.00');
    assert.equal(detail.status, 'PAID');
    assert.equal(await jobStatus(), 'PAID');
    // Through the job's own status change: in its history, with why.
    const history = await prisma.jobStatusHistory.findFirstOrThrow({
      where: { jobCardId, toStatus: 'PAID' },
    });
    assert.equal(history.fromStatus, 'INVOICED');
    const moved = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: jobCardId, action: 'job_card.status_changed' },
      orderBy: { createdAt: 'desc' },
    });
    assert.equal((moved.metadata as { creditNoteId?: string }).creditNoteId, creditNoteId);
    // No refund: no money out, no refund on the note.
    const row = await prisma.creditNote.findUniqueOrThrow({ where: { id: creditNoteId } });
    assert.equal(row.refundAmount.toString(), '0');
    assert.equal(row.refundedOn, null, 'no refund paid out');
    assert.equal(row.refundAccountId, null);
    // The payment is untouched.
    assert.equal(detail.paidAmount, '3500.00');
  });

  test('the credit note stays on record, issued and audited', async () => {
    const row = await prisma.creditNote.findUniqueOrThrow({ where: { id: creditNoteId } });
    assert.equal(row.status, 'ISSUED');
    assert.equal(row.invoiceId, invoiceId);
    assert.equal(row.reason, 'Discount given at payment');
    assert.ok(
      await prisma.auditLog.findFirst({
        where: { entityId: creditNoteId, action: 'credit_note.issued' },
      }),
    );
    assert.equal((await bookedFor(creditNoteId)).get(roles.ACCOUNTS_RECEIVABLE), -toFils('154.00'));
  });

  test('voided: the invoice is owed 154.00 again and the job card is back to Invoiced', async () => {
    await voidCreditNote(a.owner, creditNoteId, { reason: 'Issued in error' });
    const row = await prisma.creditNote.findUniqueOrThrow({ where: { id: creditNoteId } });
    assert.equal(row.status, 'VOID', 'kept on record, voided');
    assert.equal((await bookedFor(creditNoteId)).size, 0, 'its entry reversed');
    const detail = await getInvoiceDetail(a.owner, invoiceId);
    assert.equal(detail.balanceDue, '154.00');
    assert.equal(detail.status, 'PARTIALLY_PAID');
    assert.equal(detail.paidAmount, '3500.00');
    assert.equal(await jobStatus(), 'INVOICED');
    const history = await prisma.jobStatusHistory.findFirstOrThrow({
      where: { jobCardId, fromStatus: 'PAID', toStatus: 'INVOICED' },
    });
    assert.ok(history);
    assert.equal(await countUnbooked(a.owner), 0);
  });
});

describe('154.00 off the total: a discount, not a credit note', () => {
  let ownCustomerId: string;
  let jobCardId: string;
  let invoiceId: string;
  let paymentId: string;

  const jobStatus = async () =>
    (await prisma.jobCard.findUniqueOrThrow({ where: { id: jobCardId } })).status;
  const invoiceRow = () => prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  /** Sales, whichever sales accounts the lines went to. */
  const salesOf = (booked: Map<string, number>) =>
    (booked.get(roles.SALES_PARTS) ?? 0) + (booked.get(roles.SALES_LABOUR) ?? 0);
  /** Net debit per account over the invoice discount's own entries. */
  async function discountEntry() {
    const lines = await prisma.journalEntryLine.findMany({
      where: {
        organizationId: a.organizationId,
        journalEntry: { sourceType: 'INVOICE_DISCOUNT', sourceId: invoiceId },
      },
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

  // INV-000009's ten lines: 3,480 + VAT 174 = 3,654.
  const LINES = [
    ['PART', 'Tensioner assy V-belt', '1', '495'],
    ['PART', 'Boot steering', '2', '130'],
    ['PART', 'Oil seal rear main', '1', '110'],
    ['PART', 'Oil seal torque converter', '1', '35'],
    ['PART', 'Oil seal crank front', '1', '45'],
    ['PART', 'Fluid power steering', '1', '70'],
    ['PART', 'Coolant', '1', '45'],
    ['PART', 'Rear lower arm boots', '2', '20'],
    ['PART', 'Front upper and lower boots', '4', '20'],
    ['LABOUR', 'Labour and consumables', '1', '2300'],
  ] as const;

  before(async () => {
    ownCustomerId = (
      await prisma.customer.create({
        data: {
          organizationId: a.organizationId,
          name: `Shaloop discount ${RUN}`,
          phone: '050 444 7788',
        },
      })
    ).id;
    const vehicleId = (
      await prisma.vehicle.create({
        data: {
          organizationId: a.organizationId,
          customerId: ownCustomerId,
          plateNumber: `D ${RUN.slice(-5)}`,
          make: 'Nissan',
          model: 'Patrol',
        },
      })
    ).id;
    ({ jobCardId } = await checkInVehicle(a.owner, {
      mode: 'existing',
      vehicleId,
      visit: { complaint: 'Service' },
    }));
    // As INV-000009 stood before this correction: the 154.00 folded into the
    // bill as 146.68 before VAT (VAT 166.68, total 3,500), paid 3,500 by card.
    ({ invoiceId } = await createDirectInvoice(a.owner, {
      customerId: ownCustomerId,
      jobCardId,
      items: LINES.map(([itemType, description, quantity, unitPrice]) => ({
        itemType,
        description,
        quantity,
        unitPrice,
        ...(itemType === 'PART' ? { partId: partId(description) } : {}),
      })),
      discountType: 'AMOUNT',
      discount: '146.68',
    }));
    assert.equal((await invoiceRow()).totalAmount.toString(), '3500');
    ({ id: paymentId } = await recordInvoicePayment(a.owner, invoiceId, {
      amount: '3500',
      method: 'CARD',
      receivedAt: now(),
    }));
    assert.equal(await jobStatus(), 'PAID');
  });

  test('the bill discount taken off: 3,654 and VAT 174 again, 154.00 owed, job Invoiced', async () => {
    await removeBillDiscount(a.owner, invoiceId, { reason: 'Shown as a discount off the total' });
    const invoice = await invoiceRow();
    assert.equal(invoice.discountAmount.toString(), '0');
    assert.equal(invoice.subtotal.toString(), '3480');
    assert.equal(invoice.taxAmount.toString(), '174');
    assert.equal(invoice.totalAmount.toString(), '3654');
    assert.equal((await getInvoiceDetail(a.owner, invoiceId)).balanceDue, '154.00');
    assert.equal(await jobStatus(), 'INVOICED');
    const invoiceEntry = await bookedFor(invoiceId);
    assert.equal(invoiceEntry.get(roles.ACCOUNTS_RECEIVABLE), toFils('3654.00'));
    assert.equal(invoiceEntry.get(roles.VAT_OUTPUT), -toFils('174.00'));
    assert.equal(invoiceEntry.get(roles.SALES_DISCOUNTS), undefined);
  });

  test('never more than is still due', async () => {
    await expectDomainError(
      discountInvoice(a.owner, invoiceId, { amount: '154.01' }),
      /Only 154\.00 is still due/,
    );
  });

  test('154.00 off the total: invoice 3,654 and VAT 174 unchanged, paid, job Paid', async () => {
    const result = await discountInvoice(a.owner, invoiceId, {
      amount: '154',
      reason: 'Customer paid 3,500',
    });
    assert.equal(result.settlementDiscount, '154.00');
    assert.equal(result.status, 'PAID');
    const invoice = await invoiceRow();
    assert.equal(invoice.totalAmount.toString(), '3654', 'the invoice keeps its total');
    assert.equal(invoice.taxAmount.toString(), '174', 'VAT as invoiced');
    assert.equal(invoice.subtotal.toString(), '3480');
    assert.equal(invoice.discountAmount.toString(), '0', 'not a bill discount');
    assert.equal(invoice.settlementDiscount.toString(), '154');
    assert.ok(invoice.settlementDiscountOn);
    const detail = await getInvoiceDetail(a.owner, invoiceId);
    assert.equal(detail.paidAmount, '3500.00');
    assert.equal(detail.balanceDue, '0.00');
    assert.equal(detail.status, 'PAID');
    assert.equal(await jobStatus(), 'PAID');
    // The payment is untouched.
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    assert.equal(payment.amount.toString(), '3500');
    assert.equal(payment.status, 'COMPLETED');
  });

  test('no credit note, nothing refunded; a credit note waits for the discount to come off', async () => {
    assert.equal(await prisma.creditNote.count({ where: { invoiceId } }), 0);
    await expectDomainError(
      discountInvoice(a.owner, invoiceId, { amount: '1' }),
      /already been given/,
    );
    const creditable = await getCreditableInvoice(a.owner, invoiceId);
    assert.match(creditable.blocker ?? '', /Take the discount off first/);
  });

  test('the invoice shows 3,654, the discount off it, 3,500 paid, nothing due', async () => {
    const document = await getInvoiceDocument(a.owner, invoiceId);
    const rows = Object.fromEntries(document.totals.map((row) => [row.label, row.amount]));
    assert.equal(toFils(rows['Total']), toFils('3654.00'));
    assert.equal(rows['Discount'], '-154.00');
    assert.equal(toFils(rows['Total after discount']), toFils('3500.00'));
    assert.equal(toFils(rows['Amount paid']), toFils('3500.00'));
    assert.equal(toFils(rows['Balance due']), 0);
    assert.ok(!('Credit notes' in rows), 'no credit note on the invoice');
    // The order the customer reads it in.
    const labels = document.totals.map((row) => row.label);
    assert.ok(labels.indexOf('Total') < labels.indexOf('Discount'));
    assert.ok(labels.indexOf('Discount') < labels.indexOf('Amount paid'));
  });

  test('the books: the invoice as issued, the discount its own entry, receivable cleared', async () => {
    const invoiceEntry = await bookedFor(invoiceId);
    // bookedFor covers every entry with this source id: the invoice and its discount.
    const discount = await discountEntry();
    assert.equal(discount.get(roles.SALES_DISCOUNTS), toFils('154.00'));
    assert.equal(discount.get(roles.ACCOUNTS_RECEIVABLE), -toFils('154.00'));
    assert.equal(discount.size, 2, 'VAT untouched by the discount');
    assert.equal(invoiceEntry.get(roles.VAT_OUTPUT), -toFils('174.00'));
    assert.equal(salesOf(invoiceEntry), -toFils('3480.00'));
    assert.equal(invoiceEntry.get(roles.SALES_DISCOUNTS), toFils('154.00'));
    const all = await bookedFor(invoiceId, paymentId);
    assert.equal(all.get(roles.ACCOUNTS_RECEIVABLE) ?? 0, 0, '3,654 − 154 − 3,500');
    assert.equal(all.get(roles.CARD_CLEARING), toFils('3500.00'));
  });

  test('the statement: invoice, discount, payment — nothing owed', async () => {
    const statement = await getCustomerStatement(a.owner, ownCustomerId);
    const discount = statement.lines.find((line) => line.kind === 'Discount');
    assert.ok(discount, 'the discount is on the statement');
    assert.equal(discount.credit, '154.00');
    assert.ok(!statement.lines.some((line) => line.kind === 'Credit note'));
    assert.equal(toFils(statement.closing.replace('-', '')), 0);
    assert.equal((await getBalanceSheet(a.owner)).balanced, true);
    assert.equal(await countUnbooked(a.owner), 0);
  });

  test('audited: who gave it, the 154.00, the bill discount taken off', async () => {
    const given = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: invoiceId, action: 'invoice.discount_given' },
    });
    assert.equal(given.actorUserId, a.owner.id);
    assert.equal((given.afterData as { settlementDiscount: string }).settlementDiscount, '154');
    assert.equal((given.metadata as { dueBefore: string }).dueBefore, '154.00');
    assert.ok(
      await prisma.auditLog.findFirst({
        where: { entityId: invoiceId, action: 'invoice.bill_discount_removed' },
      }),
    );
  });

  test('a discounted invoice can still be edited — its total must keep covering the discount', async () => {
    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { items: true },
    });
    assert.equal(invoiceEditBlocker({ ...invoice, paidAmount: '0' }), null);
  });

  test('taken off again: owed 154.00, job back to Invoiced, its entry reversed', async () => {
    await removeInvoiceDiscount(a.owner, invoiceId, { reason: 'Given in error' });
    const invoice = await invoiceRow();
    assert.equal(invoice.settlementDiscount.toString(), '0');
    assert.equal(invoice.settlementDiscountOn, null);
    assert.equal(invoice.totalAmount.toString(), '3654');
    const detail = await getInvoiceDetail(a.owner, invoiceId);
    assert.equal(detail.balanceDue, '154.00');
    assert.equal(detail.status, 'PARTIALLY_PAID');
    assert.equal(await jobStatus(), 'INVOICED');
    assert.equal((await discountEntry()).size, 0, 'nothing of the discount stands');
    assert.ok(
      await prisma.auditLog.findFirst({
        where: { entityId: invoiceId, action: 'invoice.discount_removed' },
      }),
    );
    assert.equal((await getBalanceSheet(a.owner)).balanced, true);
    assert.equal(await countUnbooked(a.owner), 0);
  });

  test('a discount on the bill never takes it below what was paid', async () => {
    await expectDomainError(
      addBillDiscount(a.owner, invoiceId, { discount: '146.69', reason: 'Too much' }),
      /below the 3500\.00 already paid/,
    );
  });

  test('as if discounted when made: 146.68 on the bill, VAT 166.68, total 3,500 — paid, job Paid', async () => {
    const result = await addBillDiscount(a.owner, invoiceId, {
      discount: '146.68',
      reason: 'Discount agreed when the invoice was made',
    });
    assert.equal(result.taxAmount, '166.68');
    assert.equal(result.totalAmount, '3500.00');
    assert.equal(result.status, 'PAID');
    const invoice = await invoiceRow();
    assert.equal(invoice.discountAmount.toString(), '146.68');
    assert.equal(invoice.subtotal.toString(), '3333.32');
    assert.equal(invoice.taxAmount.toString(), '166.68', '174.00 − 7.32');
    assert.equal(invoice.totalAmount.toString(), '3500');
    assert.equal(invoice.settlementDiscount.toString(), '0');
    const detail = await getInvoiceDetail(a.owner, invoiceId);
    assert.equal(detail.balanceDue, '0.00');
    assert.equal(await jobStatus(), 'PAID');
    // The books: the invoice's entry with the discount in it, nothing else standing.
    const invoiceEntry = await bookedFor(invoiceId);
    assert.equal(invoiceEntry.get(roles.ACCOUNTS_RECEIVABLE), toFils('3500.00'));
    assert.equal(invoiceEntry.get(roles.SALES_DISCOUNTS), toFils('146.68'));
    assert.equal(invoiceEntry.get(roles.VAT_OUTPUT), -toFils('166.68'));
    assert.equal(salesOf(invoiceEntry), -toFils('3480.00'));
    assert.equal((await discountEntry()).size, 0);
    const all = await bookedFor(invoiceId, paymentId);
    assert.equal(all.get(roles.ACCOUNTS_RECEIVABLE) ?? 0, 0);
    // The payment is untouched.
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    assert.equal(payment.amount.toString(), '3500');
    assert.equal(payment.status, 'COMPLETED');
    // What the customer reads: the 3,654.00 they were told, 154.00 off it, 3,500.00.
    const document = await getInvoiceDocument(a.owner, invoiceId);
    const rows = document.totals.map((row) => [row.label, row.amount]);
    assert.deepEqual(rows.slice(0, 7), [
      ['Subtotal', '3480.00'],
      ['VAT 5% before discount', '174.00'],
      ['Price before discount', '3654.00'],
      ['Discount (146.68 + VAT 7.32)', '-154.00'],
      ['Total excl. VAT', '3333.32'],
      ['VAT 5%', '166.68'],
      ['Total', '3500.00'],
    ]);
    await expectDomainError(
      addBillDiscount(a.owner, invoiceId, { discount: '1', reason: 'Again' }),
      /already has a discount on the bill/,
    );
    assert.ok(
      await prisma.auditLog.findFirst({
        where: { entityId: invoiceId, action: 'invoice.bill_discount_added' },
      }),
    );
    assert.equal((await getBalanceSheet(a.owner)).balanced, true);
    assert.equal(await countUnbooked(a.owner), 0);
  });
});

describe('a round-off', () => {
  let invoiceId: string;

  test('after VAT, outside VAT, booked to Rounding adjustments', async () => {
    // 999.52 + VAT 49.98 = 1,049.50, rounded down to 1,049.00.
    ({ invoiceId } = await createDirectInvoice(a.owner, {
      customerId,
      items: [{ itemType: 'LABOUR', description: 'Repair', quantity: '1', unitPrice: '999.52' }],
      roundingAdjustment: '-0.50',
    }));
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    assert.equal(invoice.taxAmount.toString(), '49.98', 'VAT untouched by the round-off');
    assert.equal(invoice.totalAmount.toString(), '1049');
    assert.equal(invoice.roundingAdjustment.toString(), '-0.5');
    const booked = await bookedFor(invoiceId);
    assert.equal(booked.get(roles.ACCOUNTS_RECEIVABLE), toFils('1049.00'));
    assert.equal(booked.get(roles.ROUNDING), toFils('0.50'), 'rounding down is a cost');
    assert.equal(booked.get(roles.VAT_OUTPUT), -toFils('49.98'));
    const account = await prisma.chartOfAccount.findUniqueOrThrow({
      where: { id: roles.ROUNDING },
    });
    assert.equal(account.accountCode, '4095');
  });

  test('at most 5.00, and editable while unpaid', async () => {
    await expectDomainError(
      createDirectInvoice(a.owner, {
        customerId,
        items: [{ itemType: 'LABOUR', description: 'Repair', quantity: '1', unitPrice: '100' }],
        roundingAdjustment: '-5.01',
      }),
      /at most 5\.00/,
    );
    await updateInvoice(a.owner, invoiceId, {
      items: [{ itemType: 'LABOUR', description: 'Repair', quantity: '1', unitPrice: '999.52' }],
      roundingAdjustment: '0.50',
    });
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    assert.equal(invoice.totalAmount.toString(), '1050');
    assert.equal((await bookedFor(invoiceId)).get(roles.ROUNDING), -toFils('0.50'));
    // Back to rounding down for the rest.
    await updateInvoice(a.owner, invoiceId, {
      items: [{ itemType: 'LABOUR', description: 'Repair', quantity: '1', unitPrice: '999.52' }],
      roundingAdjustment: '-0.50',
    });
  });

  test('paid, then credited in full: the round-off comes back, the refund is what was paid', async () => {
    await recordInvoicePayment(a.owner, invoiceId, {
      amount: '1049',
      method: 'CASH',
      receivedAt: now(),
    });
    const creditable = await getCreditableInvoice(a.owner, invoiceId);
    const note = await createCreditNote(a.owner, invoiceId, {
      reason: 'Job cancelled',
      lines: creditable.lines.map((line) => ({ invoiceItemId: line.id, amount: line.remaining })),
    });
    assert.equal(note.totalAmount, '1049.00', '999.52 + 49.98 − 0.50');
    assert.equal(note.refundAmount, '1049.00', 'exactly what was paid');
    const row = await prisma.creditNote.findUniqueOrThrow({ where: { id: note.creditNoteId } });
    assert.equal(row.roundingAmount.toString(), '-0.5');
    const booked = await bookedFor(invoiceId, note.creditNoteId);
    assert.equal(booked.get(roles.ROUNDING), undefined, 'the round-off is fully taken back');
    assert.equal(booked.get(roles.VAT_OUTPUT), undefined);
    const detail = await getInvoiceDetail(a.owner, invoiceId);
    assert.equal(detail.balanceDue, '0.00');
  });
});

describe('everything agrees', () => {
  test('the balance sheet balances and nothing is left unbooked', async () => {
    assert.equal((await getBalanceSheet(a.owner)).balanced, true);
    assert.equal(await countUnbooked(a.owner), 0);
  });
});
