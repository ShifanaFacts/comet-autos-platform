/**
 * Integration tests for discounts, due dates and the customer's order number
 * on quotations and invoices:
 *
 *  - an invoice typed on screen stores each line's discount and the bill
 *    discount, with VAT on what the customer pays, and prints them;
 *  - its due date and order number are kept and printed, and refused when
 *    they don't make sense;
 *  - correcting an invoice prices its discounts again, with the change in
 *    the audit log;
 *  - a quotation keeps its discounts through sending, revising and being
 *    invoiced — the invoice bills exactly what was quoted;
 *  - the full workflow bills approved work with the discounts the customer
 *    approved on the quotation.
 *
 * Needs the 20260927100000_discounts migration applied.
 *
 *   npm run test:integration
 */
import 'dotenv/config';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/lib/prisma';
import { checkInVehicle } from '@/lib/workshop/check-in';
import { startInspection, saveInspection } from '@/lib/workshop/inspection';
import { saveDiagnosis } from '@/lib/workshop/diagnosis';
import {
  createEstimate,
  createQuotation,
  recordCustomerDecision,
  reviseEstimate,
  saveEstimateDraft,
  sendEstimate,
} from '@/lib/workshop/estimates';
import { recordLabour, startRepair } from '@/lib/workshop/repair';
import { recordQualityCheck } from '@/lib/workshop/quality-check';
import { createInvoice } from '@/lib/billing/invoice';
import { createDirectInvoice } from '@/lib/billing/direct-invoice';
import { updateInvoice } from '@/lib/billing/invoice-changes';
import { listInvoices } from '@/lib/billing/lists';
import { getInvoiceDocument, getQuotationDocument } from '@/lib/documents/build';
import { renderDocumentPdf } from '@/lib/documents/pdf/render';
import { localDateString } from '@/lib/format';
import { createTestOrg, expectDomainError, RUN, type TestOrg } from './support';

/** Money as stored: two decimals, whatever Decimal.toString() trims. */
const money = (value: { toString(): string } | null | undefined) =>
  Number(value?.toString() ?? 'NaN').toFixed(2);
const inDays = (days: number) => localDateString(new Date(Date.now() + days * 86400000));

let a: TestOrg;

before(async () => {
  a = await createTestOrg('Discounts', [
    { sku: 'DS-FILTER', name: 'Oil filter', cost: '30', price: '50', stock: '10' },
    { sku: 'DS-BULB', name: 'Bulb', cost: '8', price: '15', stock: '10' },
    { sku: 'DS-WIPER', name: 'Wiper', cost: '25', price: '40', stock: '10' },
    { sku: 'DS-PADS', name: 'Pads', cost: '90', price: '150', stock: '10' },
  ]);
});

after(async () => {
  await prisma.$disconnect();
});

async function customerWithVehicle(suffix: string) {
  const customer = await prisma.customer.create({
    data: {
      organizationId: a.organizationId,
      name: `Discount Customer ${suffix}`,
      phone: `050 ${suffix.padStart(3, '0')} 7722`,
    },
  });
  const vehicle = await prisma.vehicle.create({
    data: {
      organizationId: a.organizationId,
      customerId: customer.id,
      plateNumber: `D${suffix} ${RUN.slice(-4)}`,
      make: 'Nissan',
      model: 'Patrol',
    },
  });
  return { customer, vehicle };
}

/*
 * The invoice used below:
 *   Service     1 × 400.00, 10% off  →  40.00 off → 360.00
 *   Oil filter  2 ×  50.00, AED 20   →  20.00 off →  80.00
 *   Lines total                                    440.00
 *   Bill discount 5%                                −22.00 (18.00 + 4.00 by share)
 *   Total excl. VAT                                418.00
 *   VAT 5% on 342.00 and 76.00                      20.90 (17.10 + 3.80)
 *   Total                                          438.90
 */
const lines = () => [
  {
    itemType: 'LABOUR',
    description: 'Service',
    quantity: '1',
    unitPrice: '400',
    discountType: 'PERCENT',
    discount: '10',
  },
  {
    itemType: 'PART',
    description: 'Oil filter',
    quantity: '2',
    unitPrice: '50',
    discountType: 'AMOUNT',
    discount: '20',
    partId: a.parts['DS-FILTER'].id,
  },
];

describe('an invoice typed on screen', () => {
  test('stores and prints line and bill discounts, the due date and the order number', async () => {
    const { customer, vehicle } = await customerWithVehicle('10');
    const dueDate = inDays(30);
    const { invoiceId } = await createDirectInvoice(a.owner, {
      customerId: customer.id,
      vehicleId: vehicle.id,
      items: lines(),
      discountType: 'PERCENT',
      discount: '5',
      dueDate,
      customerReference: 'LPO-7781',
    });

    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    assert.equal(invoice.discountType, 'PERCENT');
    assert.equal(money(invoice.discountValue), '5.00');
    assert.equal(money(invoice.discountAmount), '22.00');
    assert.equal(money(invoice.subtotal), '418.00');
    assert.equal(money(invoice.taxAmount), '20.90');
    assert.equal(money(invoice.totalAmount), '438.90');
    assert.equal(invoice.dueDate?.toISOString().slice(0, 10), dueDate);
    assert.equal(invoice.customerReference, 'LPO-7781');
    assert.deepEqual(
      invoice.items.map((item) => [
        item.discountType,
        money(item.discountAmount),
        money(item.lineTotal),
        money(item.taxAmount),
      ]),
      [
        ['PERCENT', '40.00', '360.00', '17.10'],
        ['AMOUNT', '20.00', '80.00', '3.80'],
      ],
    );

    const document = await getInvoiceDocument(a.owner, invoiceId);
    assert.deepEqual(
      document.totals.slice(0, 5).map((total) => [total.label, money(total.amount)]),
      [
        ['Subtotal', '440.00'],
        // How the discount was reached, VAT included: 462.00 − 23.10 = 438.90.
        ['VAT 5% before discount', '22.00'],
        ['Price before discount', '462.00'],
        ['Discount 5% (22.00 + VAT 1.10)', '-23.10'],
        ['Total excl. VAT', '418.00'],
      ],
    );
    assert.deepEqual(
      document.sections[0].lines.map((line) => money(line.discount)),
      ['40.00', '20.00'],
    );
    assert.ok(document.meta.some((field) => field.label === 'Due date'));
    assert.ok(
      document.meta.some((field) => field.label === 'Your order no.' && field.value === 'LPO-7781'),
    );
    const pdf = renderDocumentPdf(document).toString('latin1');
    assert.ok(pdf.startsWith('%PDF-1.4') && pdf.trimEnd().endsWith('%%EOF'));

    // The list and its export count every discount: 40 + 20 + 22.
    const { invoices } = await listInvoices(a.owner, { q: invoice.invoiceNumber });
    assert.equal(invoices[0].totalDiscount, '82.00');
  });

  test('without discounts, nothing about an invoice changes', async () => {
    const { customer } = await customerWithVehicle('11');
    const { invoiceId } = await createDirectInvoice(a.owner, {
      customerId: customer.id,
      items: [
        {
          itemType: 'PART',
          description: 'Bulb',
          quantity: '2',
          unitPrice: '15',
          partId: a.parts['DS-BULB'].id,
        },
      ],
    });
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    assert.equal(invoice.discountType, null);
    assert.equal(money(invoice.discountAmount), '0.00');
    assert.equal(money(invoice.totalAmount), '31.50');
    // Due on the day it was issued, as before.
    assert.equal(invoice.dueDate?.getTime(), invoice.issueDate.getTime());
    const document = await getInvoiceDocument(a.owner, invoiceId);
    assert.equal(document.totals[0].label, 'Total excl. VAT');
    assert.ok(!document.meta.some((field) => field.label === 'Due date'));
    assert.ok(document.sections[0].lines.every((line) => line.discount === null));
  });

  test('refuses a due date in the past and a discount bigger than the bill', async () => {
    const { customer } = await customerWithVehicle('12');
    const base = {
      customerId: customer.id,
      items: [
        {
          itemType: 'PART',
          description: 'Wiper',
          quantity: '1',
          unitPrice: '40',
          partId: a.parts['DS-WIPER'].id,
        },
      ],
    };
    await expectDomainError(
      createDirectInvoice(a.owner, { ...base, dueDate: inDays(-1) }),
      /cannot be before the invoice date/,
    );
    await expectDomainError(
      createDirectInvoice(a.owner, { ...base, discountType: 'AMOUNT', discount: '40.01' }),
      /Bill discount cannot be more than the amount/,
    );
    await expectDomainError(
      createDirectInvoice(a.owner, {
        ...base,
        items: [{ ...base.items[0], discountType: 'PERCENT', discount: '101' }],
      }),
      /Line 1: Discount cannot exceed 100%/,
    );
  });
});

describe('correcting an invoice', () => {
  test('prices the discounts again and records the change', async () => {
    const { customer } = await customerWithVehicle('20');
    const { invoiceId } = await createDirectInvoice(a.owner, {
      customerId: customer.id,
      items: lines(),
      discountType: 'PERCENT',
      discount: '5',
    });

    // No bill discount now, AED 50 off the service, and 15 days to pay.
    const dueDate = inDays(15);
    await updateInvoice(a.owner, invoiceId, {
      items: [{ ...lines()[0], discountType: 'AMOUNT', discount: '50' }, lines()[1]],
      discountType: 'PERCENT',
      discount: '',
      dueDate,
      customerReference: 'PO 123',
    });
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    // 350.00 + 80.00 = 430.00; VAT 21.50.
    assert.equal(invoice.discountType, null);
    assert.equal(money(invoice.discountAmount), '0.00');
    assert.equal(money(invoice.subtotal), '430.00');
    assert.equal(money(invoice.taxAmount), '21.50');
    assert.equal(money(invoice.totalAmount), '451.50');
    assert.equal(invoice.dueDate?.toISOString().slice(0, 10), dueDate);
    assert.equal(invoice.customerReference, 'PO 123');

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: invoiceId, action: 'invoice.updated' },
    });
    const before = audit.beforeData as { discountAmount: string; totalAmount: string };
    const after = audit.afterData as { discountAmount: string; totalAmount: string };
    assert.equal(money(before.discountAmount), '22.00');
    assert.equal(money(before.totalAmount), '438.90');
    assert.equal(money(after.discountAmount), '0.00');
    assert.equal(money(after.totalAmount), '451.50');
  });
});

/*
 * The quotation used below:
 *   Brake job  1 × 300.00, 10% off  → 270.00
 *   Pads       1 × 150.00, AED 15   → 135.00
 *   Lines total                       405.00
 *   Bill discount AED 15              −15.00 (10.00 + 5.00 by share)
 *   Total excl. VAT                   390.00
 *   VAT 5% on 260.00 and 130.00        19.50
 *   Total                             409.50
 */
describe('a quotation', () => {
  test('keeps its discounts when sent, revised and invoiced', async () => {
    const { customer, vehicle } = await customerWithVehicle('30');
    const quote = await createQuotation(a.owner, {
      customerId: customer.id,
      vehicleId: vehicle.id,
    });
    await saveEstimateDraft(a.owner, quote.id, {
      validUntil: inDays(7),
      items: [
        {
          itemType: 'LABOUR',
          description: 'Brake job',
          quantity: '1',
          unitPrice: '300',
          discountType: 'PERCENT',
          discount: '10',
        },
        {
          itemType: 'PART',
          description: 'Pads',
          quantity: '1',
          unitPrice: '150',
          discountType: 'AMOUNT',
          discount: '15',
          // Named on the quotation, so the invoice takes it out of stock.
          partId: a.parts['DS-PADS'].id,
        },
      ],
      discountType: 'AMOUNT',
      discount: '15',
    });
    const saved = await prisma.estimate.findUniqueOrThrow({ where: { id: quote.id } });
    assert.equal(money(saved.discountAmount), '15.00');
    assert.equal(money(saved.subtotal), '390.00');
    assert.equal(money(saved.taxAmount), '19.50');
    assert.equal(money(saved.totalAmount), '409.50');

    const document = await getQuotationDocument(a.owner, quote.id);
    assert.deepEqual(
      document.totals.slice(0, 2).map((total) => [total.label, total.amount]),
      [
        ['Subtotal', '405.00'],
        ['Discount', '-15.00'],
      ],
    );

    await sendEstimate(a.owner, quote.id);

    // A revision starts as an exact copy, discounts included.
    const revision = await reviseEstimate(a.owner, quote.id);
    const copy = await prisma.estimate.findUniqueOrThrow({
      where: { id: revision.id },
      include: { items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    assert.equal(copy.discountType, 'AMOUNT');
    assert.equal(money(copy.discountAmount), '15.00');
    assert.equal(money(copy.totalAmount), '409.50');
    assert.deepEqual(
      copy.items.map((item) => money(item.discountAmount)),
      ['30.00', '15.00'],
    );

    // The revision, sent and approved, is invoiced exactly as quoted.
    await sendEstimate(a.owner, revision.id);
    await recordCustomerDecision(a.owner, revision.id, { decision: 'APPROVED', method: 'PHONE' });
    const { invoiceId } = await createDirectInvoice(a.owner, {
      customerId: customer.id,
      estimateId: revision.id,
    });
    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    assert.equal(invoice.discountType, 'AMOUNT');
    assert.equal(money(invoice.discountAmount), '15.00');
    assert.equal(money(invoice.subtotal), '390.00');
    assert.equal(money(invoice.taxAmount), '19.50');
    assert.equal(money(invoice.totalAmount), '409.50');
    assert.deepEqual(
      invoice.items.map((item) => [
        money(item.discountAmount),
        money(item.lineTotal),
        money(item.taxAmount),
      ]),
      copy.items.map((item) => [
        money(item.discountAmount),
        money(item.lineTotal),
        money(item.taxAmount),
      ]),
    );
  });
});

/*
 * The full workflow: the quotation approved with
 *   Replace drive belt  1 h × 200.00, 10% off → 180.00
 *   Wheel alignment     2 h × 100.00, AED 40  → 160.00
 *   Bill discount 5%                            −17.00 (9.00 + 8.00 by share)
 *   Total excl. VAT                             323.00
 *   VAT 5% on 171.00 and 152.00                  16.15
 *   Total                                       339.15
 * and all of it done, so the job's invoice bills exactly that.
 */
describe('the full workflow', () => {
  test('bills approved work with the discounts the customer approved', async () => {
    const { vehicle } = await customerWithVehicle('40');
    const { jobCardId } = await checkInVehicle(a.owner, {
      mode: 'existing',
      vehicleId: vehicle.id,
      visit: { complaint: 'Belt squeal and pulling left', mileage: '90000' },
    });
    const inspection = await startInspection(a.owner, jobCardId, a.technicianIds[0]);
    await saveInspection(
      a.owner,
      inspection.id,
      { items: [{ itemType: 'PART', description: 'Belt', result: 'FAILED', notes: 'Cracked' }] },
      { complete: true },
    );
    await saveDiagnosis(a.owner, jobCardId, {
      employeeId: a.technicianIds[0],
      findings: 'Cracked belt, alignment out',
      recommendedAction: 'Replace belt and align',
    });
    const estimate = await createEstimate(a.owner, jobCardId);
    await saveEstimateDraft(a.owner, estimate.id, {
      validUntil: inDays(7),
      items: [
        {
          itemType: 'LABOUR',
          description: 'Replace drive belt',
          quantity: '1',
          unitPrice: '200',
          discountType: 'PERCENT',
          discount: '10',
        },
        {
          itemType: 'LABOUR',
          description: 'Wheel alignment',
          quantity: '2',
          unitPrice: '100',
          discountType: 'AMOUNT',
          discount: '40',
        },
      ],
      discountType: 'PERCENT',
      discount: '5',
    });
    await sendEstimate(a.owner, estimate.id);
    await recordCustomerDecision(a.owner, estimate.id, {
      decision: 'APPROVED',
      method: 'IN_PERSON',
    });
    const [belt, alignment] = await prisma.estimateItem.findMany({
      where: { estimateId: estimate.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    await startRepair(a.owner, jobCardId);
    await recordLabour(a.owner, jobCardId, {
      employeeId: a.technicianIds[0],
      description: 'Replace drive belt',
      hours: '1',
      rate: '200',
      estimateItemId: belt.id,
    });
    await recordLabour(a.owner, jobCardId, {
      employeeId: a.technicianIds[0],
      description: 'Wheel alignment',
      hours: '2',
      rate: '100',
      estimateItemId: alignment.id,
    });
    await recordQualityCheck(a.owner, jobCardId, {
      employeeId: a.technicianIds[1],
      result: 'PASSED',
    });

    const invoice = await createInvoice(a.owner, jobCardId);
    const quoted = await prisma.estimate.findUniqueOrThrow({ where: { id: estimate.id } });
    assert.equal(money(quoted.totalAmount), '339.15');
    assert.equal(invoice.discountType, 'PERCENT');
    assert.equal(money(invoice.discountAmount), '17.00');
    assert.equal(money(invoice.subtotal), money(quoted.subtotal));
    assert.equal(money(invoice.taxAmount), money(quoted.taxAmount));
    assert.equal(money(invoice.totalAmount), money(quoted.totalAmount));
    const items = await prisma.invoiceItem.findMany({
      where: { invoiceId: invoice.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    assert.deepEqual(
      items.map((item) => [money(item.discountAmount), money(item.lineTotal)]),
      [
        ['20.00', '180.00'],
        ['40.00', '160.00'],
      ],
    );
  });
});
