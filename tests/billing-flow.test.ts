/**
 * Integration tests for READY → INVOICE → PAYMENT → PAID → DELIVERY →
 * DELIVERED, against the local PostgreSQL database through the real services.
 *
 * The job deliberately mixes realistic complications so the billing rules
 * are proven, not assumed:
 *  - the pads' catalog price changes after the customer approved the quote,
 *  - two pads are fitted against one approved,
 *  - one piece of labour is recorded without approval,
 *  - one piece of additional work is quoted and approved separately.
 *
 *   npm run test:integration
 */
import 'dotenv/config';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/lib/prisma';
import { AuthError } from '@/lib/auth/authorize';
import { checkInVehicle } from '@/lib/workshop/check-in';
import { startInspection, saveInspection } from '@/lib/workshop/inspection';
import { saveDiagnosis } from '@/lib/workshop/diagnosis';
import { createAdditionalEstimate, createEstimate, recordCustomerDecision, saveEstimateDraft, sendEstimate } from '@/lib/workshop/estimates';
import { getRepairWorkspace, recordLabour, recordPartUsage, startRepair } from '@/lib/workshop/repair';
import { recordQualityCheck } from '@/lib/workshop/quality-check';
import { transitionJobStatus } from '@/lib/workshop/job-status';
import { createInvoice, deliverVehicle, getBillingPreview, getJobInvoice, recordPayment } from '@/lib/billing/invoice';
import { localDateString, toLocalDateTimeInput } from '@/lib/format';
import { calculateLine } from '@/lib/money';
import { createTestOrg, expectDomainError, historyStatuses, jobStatus, RUN, type TestOrg } from './support';

const COMET_ORG = '00000000-0000-7000-8000-000000000001';
const PARTS = [
  { sku: 'AC-CLUTCH', name: 'AC compressor clutch', cost: '310.00', price: '480.00', stock: '3' },
  { sku: 'PADS', name: 'Brake pad set', cost: '95.00', price: '180.00', stock: '5' },
];
const now = () => toLocalDateTimeInput(new Date());

async function cometCounts() {
  const where = { organizationId: COMET_ORG };
  return {
    jobCards: await prisma.jobCard.count({ where }),
    invoices: await prisma.invoice.count({ where }),
    invoiceItems: await prisma.invoiceItem.count({ where }),
    payments: await prisma.payment.count({ where }),
    labours: await prisma.labour.count({ where }),
    partUsages: await prisma.partUsage.count({ where }),
    inventory: await prisma.inventoryTransaction.count({ where }),
    history: await prisma.jobStatusHistory.count({ where }),
  };
}

/** Check-in → approved quotation (labour 2.5 h @ 150, clutch 1 @ 480, pads 1 @ 180). */
async function approvedJob(org: TestOrg, suffix: string) {
  const { jobCardId } = await checkInVehicle(org.owner, {
    mode: 'new',
    customer: { name: `Billing Customer ${suffix}`, phone: `056 ${suffix.padStart(3, '0')} 7788`, email: '' },
    vehicle: { plateNumber: `B${suffix} ${RUN.slice(-4)}`, make: 'Nissan', model: 'Patrol' },
    visit: { complaint: 'AC not cooling; brake noise', mileage: '80000' },
  });
  const inspection = await startInspection(org.owner, jobCardId, org.technicianIds[0]);
  await saveInspection(org.owner, inspection.id, { items: [{ description: 'Air conditioning', result: 'FAILED', notes: 'Clutch dead' }] }, { complete: true });
  await saveDiagnosis(org.owner, jobCardId, {
    employeeId: org.technicianIds[0],
    findings: 'AC clutch failed; pads worn',
    recommendedAction: 'Replace clutch and front pads',
  });
  const estimate = await createEstimate(org.owner, jobCardId);
  await saveEstimateDraft(org.owner, estimate.id, {
    validUntil: localDateString(new Date(Date.now() + 7 * 86400000)),
    items: [
      { itemType: 'LABOUR', description: 'Replace AC compressor clutch', quantity: '2.5', unitPrice: '150' },
      { itemType: 'PART', description: 'AC compressor clutch', quantity: '1', unitPrice: '480' },
      { itemType: 'PART', description: 'Front brake pads', quantity: '1', unitPrice: '180' },
    ],
  });
  await sendEstimate(org.owner, estimate.id);
  await recordCustomerDecision(org.owner, estimate.id, { decision: 'APPROVED', method: 'IN_PERSON' });
  const lines = await prisma.estimateItem.findMany({ where: { estimateId: estimate.id } });
  const line = (description: string) => lines.find((l) => l.description === description)!.id;
  return {
    jobCardId,
    labourLine: line('Replace AC compressor clutch'),
    clutchLine: line('AC compressor clutch'),
    padsLine: line('Front brake pads'),
  };
}

let a: TestOrg;
let b: TestOrg;
let cometBefore: Awaited<ReturnType<typeof cometCounts>>;

before(async () => {
  cometBefore = await cometCounts();
  a = await createTestOrg('BillA', PARTS);
  b = await createTestOrg('BillB', PARTS);
});

after(async () => {
  await prisma.$disconnect();
});

describe('invoice → payment → delivery', () => {
  let job: Awaited<ReturnType<typeof approvedJob>>;
  let unapprovedLabourId: string;
  let otherJob: Awaited<ReturnType<typeof approvedJob>>;

  test('setup: repair with price change, over-fitting, unapproved and approved additional work', async () => {
    job = await approvedJob(a, '1');
    await startRepair(a.owner, job.jobCardId);
    // The catalog price of the pads goes up after the customer approved 180.
    await prisma.part.update({ where: { id: a.parts['PADS'].id }, data: { defaultSellingPrice: '200.00' } });

    await recordLabour(a.owner, job.jobCardId, {
      employeeId: a.technicianIds[0],
      description: 'Replace AC compressor clutch',
      hours: '2.5',
      rate: '150',
      estimateItemId: job.labourLine,
    });
    await recordPartUsage(a.owner, job.jobCardId, { partId: a.parts['AC-CLUTCH'].id, quantity: '1', employeeId: a.technicianIds[0], estimateItemId: job.clutchLine });
    await recordPartUsage(a.owner, job.jobCardId, { partId: a.parts['PADS'].id, quantity: '2', employeeId: a.technicianIds[0], estimateItemId: job.padsLine });
    const unapproved = await recordLabour(a.owner, job.jobCardId, {
      employeeId: a.technicianIds[1],
      description: 'Clean throttle body (not approved)',
      hours: '1',
      rate: '150',
    });
    unapprovedLabourId = unapproved.id;

    const additional = await createAdditionalEstimate(a.owner, job.jobCardId, { notes: 'Water pump gasket leaking' });
    await saveEstimateDraft(a.owner, additional.id, {
      validUntil: localDateString(new Date(Date.now() + 3 * 86400000)),
      items: [{ itemType: 'LABOUR', description: 'Replace water pump gasket', quantity: '1', unitPrice: '150' }],
    });
    await sendEstimate(a.owner, additional.id);
    await recordCustomerDecision(a.owner, additional.id, { decision: 'APPROVED', method: 'PHONE' });
    const additionalLine = (await getRepairWorkspace(a.owner, job.jobCardId)).approvedLines.find((l) => l.kind === 'ADDITIONAL')!;
    await recordLabour(a.owner, job.jobCardId, {
      employeeId: a.technicianIds[1],
      description: 'Replace water pump gasket',
      hours: '1',
      rate: '150',
      estimateItemId: additionalLine.id,
    });
    await recordQualityCheck(a.owner, job.jobCardId, { employeeId: a.technicianIds[1], result: 'PASSED' });
    assert.equal(await jobStatus(job.jobCardId), 'READY');
  });

  test('14a. an invoice cannot be created for a job that is not ready', async () => {
    otherJob = await approvedJob(a, '2');
    await expectDomainError(createInvoice(a.owner, otherJob.jobCardId), /ready/);
    await expectDomainError(prisma.$transaction((tx) => transitionJobStatus(tx, a.owner, job.jobCardId, 'INVOICED')), /Create the invoice/);
    assert.equal(await prisma.invoice.count({ where: { jobCardId: otherJob.jobCardId } }), 0);
  });

  test('1–5. a READY job is invoiced for approved work only, priced and taxed on the server', async () => {
    const preview = await getBillingPreview(a.owner, job.jobCardId);
    assert.ok(preview.notes.some((n) => n.kind === 'EXCLUDED' && n.message.includes('throttle')));
    assert.ok(preview.notes.some((n) => n.kind === 'PRICE_DIFFERS' && n.message.includes('200.00') && n.message.includes('180.00')));
    assert.ok(preview.notes.some((n) => n.kind === 'QUANTITY_ABOVE_APPROVED' && n.message.includes('Front brake pads')));

    const invoice = await createInvoice(a.owner, job.jobCardId);
    assert.match(invoice.invoiceNumber, /^INV-\d{6}$/);
    assert.equal(invoice.status, 'ISSUED');
    assert.equal(invoice.invoiceType, 'TAX_INVOICE');
    assert.equal(await jobStatus(job.jobCardId), 'INVOICED');
    assert.deepEqual((await historyStatuses(job.jobCardId)).slice(-2), ['READY', 'INVOICED']);

    const items = await prisma.invoiceItem.findMany({ where: { invoiceId: invoice.id }, include: { partUsage: true, labour: true } });
    // Labour 2.5 h, clutch, pads (×1 of the 2 fitted), approved additional labour — 4 lines.
    assert.equal(items.length, 4);
    assert.ok(items.every((i) => (i.labourId ? i.labour!.estimateItemId : i.partUsage!.estimateItemId)), 'every line traces to an approved estimate line');
    assert.ok(!items.some((i) => i.labourId === unapprovedLabourId), 'unapproved work is not billed');

    const pads = items.find((i) => i.description.startsWith('Front brake pads'))!;
    assert.equal(pads.unitPrice.toString(), '180', 'billed at the approved price, not the new catalog price');
    assert.equal(pads.quantity.toString(), '1', 'only the approved quantity is billed');
    assert.equal(pads.partUsage!.unitPrice.toString(), '200', 'the actual usage price is still preserved');

    // 375 + 480 + 180 + 150 = 1185.00; VAT at 5% per line = 18.75 + 24.00 + 9.00 + 7.50 = 59.25
    assert.equal(invoice.subtotal.toString(), '1185');
    assert.equal(invoice.taxAmount.toString(), '59.25');
    assert.equal(invoice.totalAmount.toString(), '1244.25');
    for (const item of items) {
      const expected = calculateLine({ quantity: item.quantity.toString(), unitPrice: item.unitPrice.toString(), taxRate: item.taxRate!.toString() });
      assert.equal(item.lineTotal.toString(), String(Number(expected.lineTotal)));
      assert.equal(item.taxAmount!.toString(), String(Number(expected.taxAmount)));
      assert.equal(item.taxRate!.toString(), '5');
    }
    assert.equal(invoice.customerName, 'Billing Customer 1', 'customer snapshotted on the invoice');

    // One live invoice per job: the service refuses, and so does the database.
    await expectDomainError(createInvoice(a.owner, job.jobCardId), /ready|already invoiced/);
    await assert.rejects(
      prisma.invoice.create({
        data: {
          organizationId: a.organizationId,
          branchId: a.branchId,
          jobCardId: job.jobCardId,
          customerId: invoice.customerId,
          invoiceType: 'TAX_INVOICE',
          invoiceNumber: `DUP-${RUN}`,
          status: 'ISSUED',
          issueDate: new Date(),
          subtotal: '1',
          taxAmount: '0',
          totalAmount: '1',
          createdByUserId: a.owner.id,
        },
      }),
      /Unique constraint|one_live_invoice_per_job_card/i,
    );
  });

  test('6. the invoice starts UNPAID', async () => {
    const invoice = (await getJobInvoice(a.owner, job.jobCardId))!;
    assert.equal(invoice.paymentState, 'UNPAID');
    assert.equal(invoice.paidAmount, '0.00');
    assert.equal(invoice.balanceDue, '1244.25');
  });

  test('10. an unpaid job cannot be delivered', async () => {
    await expectDomainError(deliverVehicle(a.owner, job.jobCardId, {}), /balance due \(1244\.25\)/);
    await expectDomainError(prisma.$transaction((tx) => transitionJobStatus(tx, a.owner, job.jobCardId, 'PAID')), /fully settled/);
  });

  test('7. a partial payment makes the invoice PARTIALLY_PAID', async () => {
    const payment = await recordPayment(a.owner, job.jobCardId, {
      amount: '500',
      method: 'CARD',
      receivedAt: now(),
      referenceNumber: 'SLIP-001',
      notes: 'Deposit',
    });
    assert.match(payment.paymentNumber!, /^RCT-\d{6}$/);
    assert.equal(payment.receivedByUserId, a.owner.id);
    const invoice = (await getJobInvoice(a.owner, job.jobCardId))!;
    assert.equal(invoice.status, 'PARTIALLY_PAID');
    assert.equal(invoice.paymentState, 'PARTIALLY_PAID');
    assert.equal(invoice.paidAmount, '500.00');
    assert.equal(invoice.balanceDue, '744.25');
    assert.equal(await jobStatus(job.jobCardId), 'INVOICED', 'a part-paid job is not PAID');
    await expectDomainError(deliverVehicle(a.owner, job.jobCardId, {}), /balance due \(744\.25\)/);
  });

  test('9. overpayment and invalid payments are rejected', async () => {
    await expectDomainError(recordPayment(a.owner, job.jobCardId, { amount: '744.26', method: 'CASH', receivedAt: now() }), /more than the balance due \(744\.25\)/);
    for (const amount of ['0', '-5', 'abc', '10.123']) {
      await expectDomainError(recordPayment(a.owner, job.jobCardId, { amount, method: 'CASH', receivedAt: now() }), /Enter an amount/);
    }
    await expectDomainError(recordPayment(a.owner, job.jobCardId, { amount: '1', method: 'BARTER', receivedAt: now() }), /how the customer paid/);
    await expectDomainError(
      recordPayment(a.owner, job.jobCardId, { amount: '1', method: 'CASH', receivedAt: toLocalDateTimeInput(new Date(Date.now() + 86400000)) }),
      /future/,
    );
    await expectDomainError(recordPayment(a.owner, job.jobCardId, { amount: '1', method: 'CASH', receivedAt: '2020-01-01T10:00' }), /before the invoice/);
    // The database refuses a non-positive payment outright.
    const invoice = (await getJobInvoice(a.owner, job.jobCardId))!;
    await assert.rejects(
      prisma.payment.create({
        data: { organizationId: a.organizationId, invoiceId: invoice.id, amount: '-10', method: 'CASH', receivedByUserId: a.owner.id },
      }),
      /payments_positive_amount|check constraint/i,
    );
    assert.equal((await getJobInvoice(a.owner, job.jobCardId))!.balanceDue, '744.25', 'rejected payments changed nothing');
  });

  test('8. paying the balance makes the invoice PAID and the job PAID', async () => {
    await recordPayment(a.owner, job.jobCardId, { amount: '744.25', method: 'CASH', receivedAt: now() });
    const invoice = (await getJobInvoice(a.owner, job.jobCardId))!;
    assert.equal(invoice.status, 'PAID');
    assert.equal(invoice.balanceDue, '0.00');
    assert.equal(invoice.paidAmount, '1244.25');
    assert.equal(await jobStatus(job.jobCardId), 'PAID');
    assert.deepEqual((await historyStatuses(job.jobCardId)).slice(-2), ['INVOICED', 'PAID']);
    await expectDomainError(recordPayment(a.owner, job.jobCardId, { amount: '1', method: 'CASH', receivedAt: now() }), /already fully paid/);
  });

  test('11 + 12. a paid job is delivered, recording who and when', async () => {
    await expectDomainError(prisma.$transaction((tx) => transitionJobStatus(tx, a.owner, job.jobCardId, 'DELIVERED')), /Record the delivery/);
    const before = Date.now();
    await deliverVehicle(a.owner, job.jobCardId, { notes: 'Keys and old parts handed over' });
    const delivered = await prisma.jobCard.findUniqueOrThrow({ where: { id: job.jobCardId } });
    assert.equal(delivered.status, 'DELIVERED');
    assert.equal(delivered.deliveredByUserId, a.owner.id);
    assert.ok(delivered.deliveredAt && delivered.deliveredAt.getTime() >= before - 1000);
    assert.ok(delivered.closedAt);
    assert.equal(delivered.deliveryNotes, 'Keys and old parts handed over');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: job.jobCardId, action: 'job_card.delivered' } });
    assert.equal(audit.actorUserId, a.owner.id);
    await expectDomainError(deliverVehicle(a.owner, job.jobCardId, {}), /Only a fully paid job/);
    const actions = (await prisma.auditLog.findMany({ where: { organizationId: a.organizationId, action: { in: ['invoice.issued', 'payment.recorded', 'job_card.delivered'] } } })).map((l) => l.action);
    assert.deepEqual(actions.sort(), ['invoice.issued', 'job_card.delivered', 'payment.recorded', 'payment.recorded']);
  });

  test('13. other organizations and unauthorized users are rejected', async () => {
    // Org B cannot see, invoice, pay or deliver org A's job.
    assert.equal(await getJobInvoice(b.owner, job.jobCardId), null);
    await expectDomainError(createInvoice(b.owner, job.jobCardId), /could not be found/);
    await expectDomainError(recordPayment(b.owner, job.jobCardId, { amount: '1', method: 'CASH', receivedAt: now() }), /could not be found/);
    await expectDomainError(deliverVehicle(b.owner, job.jobCardId, {}), /could not be found/);
    await expectDomainError(getBillingPreview(b.owner, job.jobCardId), /could not be found/);

    // A user without the billing permissions can't invoice or take payment.
    const other = await approvedJob(b, '3');
    await startRepair(b.owner, other.jobCardId);
    await recordLabour(b.owner, other.jobCardId, { employeeId: b.technicianIds[0], description: 'Replace AC compressor clutch', hours: '2.5', rate: '150', estimateItemId: other.labourLine });
    await recordPartUsage(b.owner, other.jobCardId, { partId: b.parts['AC-CLUTCH'].id, quantity: '1', employeeId: b.technicianIds[0], estimateItemId: other.clutchLine });
    await recordPartUsage(b.owner, other.jobCardId, { partId: b.parts['PADS'].id, quantity: '1', employeeId: b.technicianIds[0], estimateItemId: other.padsLine });
    await recordQualityCheck(b.owner, other.jobCardId, { employeeId: b.technicianIds[0], result: 'PASSED' });
    await assert.rejects(createInvoice(b.viewer, other.jobCardId), AuthError);
    await createInvoice(b.owner, other.jobCardId);
    await assert.rejects(recordPayment(b.viewer, other.jobCardId, { amount: '1', method: 'CASH', receivedAt: now() }), AuthError);
    await assert.rejects(deliverVehicle(b.viewer, other.jobCardId, {}), AuthError);
  });

  test('14b. invoicing and payment respect the job state', async () => {
    // otherJob (org A) is only APPROVED: no invoice, no payment, no delivery.
    await expectDomainError(recordPayment(a.owner, otherJob.jobCardId, { amount: '1', method: 'CASH', receivedAt: now() }), /Create the invoice/);
    await expectDomainError(deliverVehicle(a.owner, otherJob.jobCardId, {}), /not been invoiced/);
    // A delivered job can't be invoiced again.
    await expectDomainError(createInvoice(a.owner, job.jobCardId), /ready/);
  });

  test('15. existing Comet Autos data is untouched', async () => {
    assert.deepEqual(await cometCounts(), cometBefore);
  });
});
