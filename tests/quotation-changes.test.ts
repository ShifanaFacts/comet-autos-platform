/**
 * Integration tests for changing an approved quotation.
 *
 * The approved version is never edited: changing it makes the next version
 * (same lines, then add / remove / change), which the customer approves.
 * Until then the job is back at the quotation step. Only the latest
 * version is ever invoiced, and once invoiced — or once work has started —
 * a change is refused with what to do instead.
 *
 *   npm run test:integration
 */
import 'dotenv/config';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/lib/prisma';
import { checkInVehicle } from '@/lib/workshop/check-in';
import {
  approvedChangeBlocker,
  createQuotation,
  recordCustomerDecision,
  reviseEstimate,
  saveEstimateDraft,
  sendEstimate,
} from '@/lib/workshop/estimates';
import { createDirectInvoice } from '@/lib/billing/direct-invoice';
import { localDateString } from '@/lib/format';
import { createTestOrg, expectDomainError, jobStatus, RUN, type TestOrg } from './support';

const validUntil = () => localDateString(new Date(Date.now() + 7 * 86400000));
const money = (value: { toString(): string } | null | undefined) => Number(value?.toString() ?? 'NaN').toFixed(2);

let a: TestOrg;

before(async () => {
  a = await createTestOrg('QuoteChange');
});

after(async () => {
  await prisma.$disconnect();
});

async function party(suffix: string) {
  const customer = await prisma.customer.create({
    data: { organizationId: a.organizationId, name: `Change Customer ${suffix}`, phone: `050 ${suffix.padStart(3, '0')} 5522` },
  });
  const vehicle = await prisma.vehicle.create({
    data: { organizationId: a.organizationId, customerId: customer.id, plateNumber: `C${suffix} ${RUN.slice(-4)}`, make: 'Nissan', model: 'Patrol' },
  });
  return { customer, vehicle };
}

/** A quotation priced, sent and approved by phone. */
async function approvedQuotation(input: { customerId: string; jobCardId?: string; vehicleId?: string }) {
  const quote = await createQuotation(a.owner, input);
  await saveEstimateDraft(a.owner, quote.id, {
    validUntil: validUntil(),
    items: [
      { itemType: 'LABOUR', description: 'Brake service', quantity: '1', unitPrice: '200' },
      { itemType: 'PART', description: 'Brake pads', quantity: '1', unitPrice: '150' },
    ],
  });
  await sendEstimate(a.owner, quote.id);
  await recordCustomerDecision(a.owner, quote.id, { decision: 'APPROVED', method: 'PHONE' });
  return quote;
}

describe('changing an approved quotation on a job card', () => {
  let jobCardId: string;
  let firstId: string;
  let secondId: string;
  let customerId: string;

  test('it opens the next version; the approved one is kept as it was', async () => {
    const { customer, vehicle } = await party('61');
    customerId = customer.id;
    ({ jobCardId } = await checkInVehicle(a.owner, { mode: 'existing', vehicleId: vehicle.id, visit: { complaint: 'Brakes' } }));
    const first = await approvedQuotation({ customerId, jobCardId });
    firstId = first.id;
    assert.equal(await jobStatus(jobCardId), 'APPROVED');
    assert.equal(await approvedChangeBlocker(prisma, a.organizationId, first), null);

    const revision = await reviseEstimate(a.owner, firstId);
    secondId = revision.id;
    assert.equal(revision.status, 'DRAFT');
    assert.match(revision.estimateNumber, /-R2$/);
    assert.equal(await prisma.estimateItem.count({ where: { estimateId: secondId } }), 2, 'same lines to start from');

    const original = await prisma.estimate.findUniqueOrThrow({ where: { id: firstId }, include: { approvals: true } });
    assert.equal(original.status, 'APPROVED', 'the approval stays on record');
    assert.equal(original.approvals.length, 1);
    assert.equal(await jobStatus(jobCardId), 'ESTIMATE', 'back at the quotation step');
  });

  test('the replaced version can’t be invoiced', async () => {
    await expectDomainError(
      createDirectInvoice(a.owner, { customerId, estimateId: firstId }),
      /newer version/,
    );
  });

  test('add and remove lines, the customer approves, and the new version is what gets billed', async () => {
    await saveEstimateDraft(a.owner, secondId, {
      validUntil: validUntil(),
      items: [
        { itemType: 'LABOUR', description: 'Brake service', quantity: '1', unitPrice: '200' },
        { itemType: 'PART', description: 'Brake discs (added)', quantity: '2', unitPrice: '180' },
      ],
    });
    await sendEstimate(a.owner, secondId);
    await recordCustomerDecision(a.owner, secondId, { decision: 'APPROVED', method: 'IN_PERSON' });
    assert.equal(await jobStatus(jobCardId), 'APPROVED');

    const { invoiceId } = await createDirectInvoice(a.owner, { customerId, estimateId: secondId });
    const [invoice, second] = await Promise.all([
      prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { items: true } }),
      prisma.estimate.findUniqueOrThrow({ where: { id: secondId } }),
    ]);
    assert.equal(money(invoice.totalAmount), money(second.totalAmount));
    assert.equal(invoice.items.length, 2);
    assert.ok(invoice.items.some((item) => item.description.includes('discs')));
    assert.ok(!invoice.items.some((item) => item.description === 'Brake pads'), 'the removed line isn’t billed');
  });

  test('once invoiced, it can’t be changed — correct the invoice instead', async () => {
    await expectDomainError(reviseEstimate(a.owner, secondId), /Already invoiced/);
  });
});

describe('changing an approved quotation without a job card', () => {
  test('versions the document; once invoiced, refused', async () => {
    const { customer, vehicle } = await party('62');
    const first = await approvedQuotation({ customerId: customer.id, vehicleId: vehicle.id });
    const revision = await reviseEstimate(a.owner, first.id);
    await saveEstimateDraft(a.owner, revision.id, {
      validUntil: validUntil(),
      items: [{ itemType: 'PART', description: 'Wiper blades', quantity: '2', unitPrice: '25' }],
    });
    await sendEstimate(a.owner, revision.id);
    await recordCustomerDecision(a.owner, revision.id, { decision: 'APPROVED', method: 'PHONE' });
    await createDirectInvoice(a.owner, { customerId: customer.id, estimateId: revision.id });
    await expectDomainError(reviseEstimate(a.owner, revision.id), /Already invoiced/);
  });
});

describe('once work has started', () => {
  test('a change is refused and points to additional work', async () => {
    const { customer, vehicle } = await party('63');
    const { jobCardId } = await checkInVehicle(a.owner, { mode: 'existing', vehicleId: vehicle.id, visit: { complaint: 'Noise' } });
    const quote = await approvedQuotation({ customerId: customer.id, jobCardId });
    // The detailed workflow's repair step (test workshop only).
    await prisma.jobCard.update({ where: { id: jobCardId }, data: { status: 'REPAIR' } });
    await expectDomainError(reviseEstimate(a.owner, quote.id), /additional work/);
  });
});

describe('a ledger counter that has fallen behind', () => {
  test('invoicing still works: the counter moves past the numbers already used', async () => {
    const { customer, vehicle } = await party('64');
    const quote = await approvedQuotation({ customerId: customer.id, vehicleId: vehicle.id });
    // Put the test workshop's counter back to a number already in its books.
    await prisma.documentNumberSequence.updateMany({
      where: { organizationId: a.organizationId, documentType: 'JOURNAL_ENTRY', branchId: null },
      data: { nextNumber: 1 },
    });
    const { invoiceId } = await createDirectInvoice(a.owner, { customerId: customer.id, estimateId: quote.id });
    assert.ok(invoiceId, 'the invoice was saved');
    const numbers = await prisma.journalEntry.findMany({
      where: { organizationId: a.organizationId },
      select: { entryNumber: true },
    });
    const list = numbers.map((row) => row.entryNumber);
    assert.equal(new Set(list).size, list.length, 'no number used twice');
  });
});
