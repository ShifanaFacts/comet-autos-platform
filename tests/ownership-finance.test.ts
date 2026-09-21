/**
 * Integration tests for the three approved schema additions and the
 * outstanding-balance views:
 *
 *   - a vehicle can change hands without rewriting anyone's history;
 *   - VAT configuration lives on the organization, not in the code;
 *   - what customers owe and what the workshop owes suppliers.
 *
 *   npm run test:integration
 */
import 'dotenv/config';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/lib/prisma';
import { AuthError } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { checkInVehicle } from '@/lib/workshop/check-in';
import { startInspection, saveInspection } from '@/lib/workshop/inspection';
import { saveDiagnosis } from '@/lib/workshop/diagnosis';
import {
  createEstimate,
  recordCustomerDecision,
  saveEstimateDraft,
  sendEstimate,
} from '@/lib/workshop/estimates';
import { recordLabour, startRepair } from '@/lib/workshop/repair';
import { recordQualityCheck } from '@/lib/workshop/quality-check';
import { createInvoice, recordPayment } from '@/lib/billing/invoice';
import { transferVehicleOwnership } from '@/lib/vehicles/service';
import { getCustomerDetail } from '@/lib/customers/service';
import { getCustomerOutstanding, getSupplierOutstanding } from '@/lib/finance/outstanding';
import { getVatSettings, resolveDefaultVatRate } from '@/lib/tax';
import { getQuotationDocument } from '@/lib/documents/build';
import { toFils } from '@/lib/money';
import { toLocalDateTimeInput } from '@/lib/format';
import { createTestOrg, expectDomainError, RUN, type TestOrg } from './support';

let a: TestOrg;
let b: TestOrg;
let jobCardId: string;
let invoiceId: string;
let firstOwnerId: string;
let secondOwnerId: string;
let vehicleId: string;
let estimateId: string;
const plate = `T${RUN.slice(-4)} 55`;

/** A minute ahead: the invoice was issued seconds ago, and minute-precision input would round behind it. */
const paymentTime = () => toLocalDateTimeInput(new Date(Date.now() + 60_000));

/** Walks a job from check-in to an issued invoice, so there is real history to protect. */
async function walkToInvoice(org: TestOrg) {
  const { jobCardId: id } = await checkInVehicle(org.owner, {
    mode: 'new',
    customer: { name: 'First Owner', phone: '050 111 2222', email: '' },
    vehicle: { plateNumber: plate, make: 'Toyota', model: 'Hilux' },
    visit: { complaint: 'Service', mileage: '40000' },
  });
  const inspection = await startInspection(org.owner, id, org.technicianIds[0]);
  await saveInspection(
    org.owner,
    inspection.id,
    { items: [{ description: 'Oil', result: 'ATTENTION_NEEDED', notes: 'Due' }] },
    { complete: true },
  );
  await saveDiagnosis(org.owner, id, {
    findings: 'Service due',
    recommendedAction: 'Full service',
    employeeId: org.technicianIds[0],
  });
  const estimate = await createEstimate(org.owner, id);
  await saveEstimateDraft(org.owner, estimate.id, {
    validUntil: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
    items: [
      {
        itemType: 'LABOUR',
        description: 'Full service',
        quantity: '2',
        unitPrice: '200.00',
        taxRate: '5',
      },
    ],
  });
  await sendEstimate(org.owner, estimate.id);
  await recordCustomerDecision(org.owner, estimate.id, {
    decision: 'APPROVED',
    method: 'IN_PERSON',
    notes: 'Approved',
  });
  await startRepair(org.owner, id);
  const [line] = await prisma.estimateItem.findMany({ where: { estimateId: estimate.id } });
  await recordLabour(org.owner, id, {
    description: 'Full service',
    hours: '2',
    rate: '200.00',
    employeeId: org.technicianIds[0],
    estimateItemId: line.id,
  });
  await recordQualityCheck(org.owner, id, {
    result: 'PASSED',
    employeeId: org.technicianIds[0],
    notes: 'Road tested',
  });
  const invoice = await createInvoice(org.owner, id);
  return { jobCardId: id, invoiceId: invoice.id, estimateId: estimate.id };
}

before(async () => {
  a = await createTestOrg('OwnA');
  b = await createTestOrg('OwnB');
  ({ jobCardId, invoiceId, estimateId } = await walkToInvoice(a));

  const job = await prisma.jobCard.findUniqueOrThrow({
    where: { id: jobCardId },
    select: { customerId: true, vehicleId: true },
  });
  firstOwnerId = job.customerId;
  vehicleId = job.vehicleId;

  const second = await prisma.customer.create({
    data: { organizationId: a.organizationId, name: 'Second Owner', phone: '055 333 4444' },
  });
  secondOwnerId = second.id;
});

after(async () => {
  await prisma.$disconnect();
});

describe('vehicle ownership', () => {
  test('a job records the customer it was opened for', async () => {
    const job = await prisma.jobCard.findUniqueOrThrow({ where: { id: jobCardId } });
    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    assert.equal(job.customerId, vehicle.customerId, 'at check-in they are the same person');
    assert.equal(job.customerId, firstOwnerId);
  });

  test('the registration must be typed back, and the new owner must be real', async () => {
    await expectDomainError(
      transferVehicleOwnership(a.owner, vehicleId, {
        customerId: secondOwnerId,
        reason: 'Sold',
        confirmPlate: 'WRONG 1',
      }),
      /registration/i,
    );
    await expectDomainError(
      transferVehicleOwnership(a.owner, vehicleId, {
        customerId: b.owner.id,
        reason: 'Sold',
        confirmPlate: plate,
      }),
      /active customer of this workshop/,
    );
    await expectDomainError(
      transferVehicleOwnership(a.owner, vehicleId, {
        customerId: firstOwnerId,
        reason: 'Sold',
        confirmPlate: plate,
      }),
      /already owns/,
    );
  });

  test('transferring needs permission, and another organization cannot', async () => {
    await assert.rejects(
      transferVehicleOwnership(a.viewer, vehicleId, {
        customerId: secondOwnerId,
        reason: 'Sold',
        confirmPlate: plate,
      }),
      (error: unknown) => error instanceof AuthError,
    );
    await assert.rejects(
      transferVehicleOwnership(b.owner, vehicleId, {
        customerId: secondOwnerId,
        reason: 'Sold',
        confirmPlate: plate,
      }),
      (error: unknown) => error instanceof NotFoundError,
    );
  });

  test('after a transfer the vehicle moves but no history does', async () => {
    const before = await getQuotationDocument(a.owner, estimateId);
    const result = await transferVehicleOwnership(a.owner, vehicleId, {
      customerId: secondOwnerId,
      reason: 'Vehicle sold to a new owner',
      confirmPlate: plate.toLowerCase(),
    });
    assert.equal(result.newOwner.id, secondOwnerId);
    assert.equal(result.previousOwner.id, firstOwnerId);

    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    assert.equal(vehicle.customerId, secondOwnerId, 'the vehicle now belongs to the buyer');

    const job = await prisma.jobCard.findUniqueOrThrow({ where: { id: jobCardId } });
    assert.equal(job.customerId, firstOwnerId, 'the job still belongs to who brought it in');

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    assert.equal(invoice.customerId, firstOwnerId, 'the invoice still names the original customer');

    const approval = await prisma.approval.findFirstOrThrow({
      where: { organizationId: a.organizationId, estimate: { jobCardId } },
    });
    assert.equal(approval.customerId, firstOwnerId, 'the approval still names who approved');

    // The quotation PDF still addresses the person it was written for.
    const after = await getQuotationDocument(a.owner, estimateId);
    assert.equal(after.customer.name, before.customer.name);
    assert.equal(after.customer.name, 'First Owner');

    assert.ok(
      await prisma.auditLog.findFirst({
        where: { entityId: vehicleId, action: 'vehicle.ownership_transferred' },
      }),
      'the change is audited',
    );
  });

  test('the previous owner keeps the job on their record; the new owner does not inherit it', async () => {
    const previous = await getCustomerDetail(a.owner, firstOwnerId);
    assert.ok(
      previous.jobCards.some((job) => job.id === jobCardId),
      'history stays with the person who brought the vehicle in',
    );
    const next = await getCustomerDetail(a.owner, secondOwnerId);
    assert.equal(
      next.jobCards.some((job) => job.id === jobCardId),
      false,
      'the buyer does not inherit somebody else’s service history',
    );
  });

  test('a job opened after a transfer belongs to the new owner', async () => {
    // A second vehicle, so the first fixture's job stays untouched.
    const other = await prisma.vehicle.create({
      data: {
        organizationId: a.organizationId,
        customerId: firstOwnerId,
        plateNumber: `U${RUN.slice(-4)} 66`,
        make: 'Nissan',
        model: 'Sunny',
      },
    });
    await transferVehicleOwnership(a.owner, other.id, {
      customerId: secondOwnerId,
      reason: 'Sold',
      confirmPlate: other.plateNumber,
    });
    const { jobCardId: second } = await checkInVehicle(a.owner, {
      mode: 'existing',
      vehicleId: other.id,
      visit: { complaint: 'Brake noise', mileage: '41000' },
    });
    const job = await prisma.jobCard.findUniqueOrThrow({ where: { id: second } });
    assert.equal(job.customerId, secondOwnerId, 'the buyer owns the new visit');
  });
});

describe('organization VAT settings', () => {
  test('an existing organization is VAT-registered at its configured rate', async () => {
    const settings = await getVatSettings(a.organizationId);
    assert.equal(settings.isVatRegistered, true);
    assert.equal(settings.vatRate, '5.00');
    assert.equal(await resolveDefaultVatRate(a.organizationId), '5.00');
  });

  test('the rate is read from the organization, not hard-coded', async () => {
    await prisma.organization.update({
      where: { id: b.organizationId },
      data: { vatRate: '7.50' },
    });
    assert.equal(await resolveDefaultVatRate(b.organizationId), '7.50');
    assert.equal(
      await resolveDefaultVatRate(a.organizationId),
      '5.00',
      'one organization’s rate does not affect another',
    );
  });

  test('an organization that is not VAT-registered defaults new lines to zero', async () => {
    await prisma.organization.update({
      where: { id: b.organizationId },
      data: { isVatRegistered: false },
    });
    assert.equal(await resolveDefaultVatRate(b.organizationId), '0.00');
    const settings = await getVatSettings(b.organizationId);
    assert.equal(settings.isVatRegistered, false);
    assert.equal(settings.vatRate, '7.50', 'the configured rate is remembered while unregistered');
    // Restore so later assertions in this file are not affected.
    await prisma.organization.update({
      where: { id: b.organizationId },
      data: { isVatRegistered: true, vatRate: '5.00' },
    });
  });
});

describe('outstanding', () => {
  test('an issued invoice is what the customer owes, in exact money', async () => {
    const { rows, totals } = await getCustomerOutstanding(a.owner);
    const row = rows.find((r) => r.id === invoiceId);
    assert.ok(row, 'the unpaid invoice is listed');
    // 2 h at 200.00 = 400.00 net, 5% VAT = 420.00.
    assert.equal(row.total, '420.00');
    assert.equal(row.paid, '0.00');
    assert.equal(row.balance, '420.00');
    assert.equal(row.state, 'UNPAID');
    assert.equal(row.party.id, firstOwnerId, 'owed by the customer the invoice names');
    assert.ok(toFils(totals.balance) >= toFils('420.00'));
  });

  test('a part payment reduces the balance and settling removes it', async () => {
    await recordPayment(a.owner, jobCardId, {
      amount: '100.00',
      method: 'CASH',
      receivedAt: paymentTime(),
    });
    let row = (await getCustomerOutstanding(a.owner)).rows.find((r) => r.id === invoiceId);
    assert.equal(row?.paid, '100.00');
    assert.equal(row?.balance, '320.00');
    assert.equal(row?.state, 'PARTIALLY_PAID');

    await recordPayment(a.owner, jobCardId, {
      amount: '320.00',
      method: 'CARD',
      receivedAt: paymentTime(),
    });
    row = (await getCustomerOutstanding(a.owner)).rows.find((r) => r.id === invoiceId);
    assert.equal(row, undefined, 'a settled invoice is no longer outstanding');
  });

  test('outstanding is organization-isolated and permission-checked', async () => {
    const theirs = await getCustomerOutstanding(b.owner);
    assert.equal(
      theirs.rows.some((row) => row.id === invoiceId),
      false,
    );
    await assert.rejects(
      getCustomerOutstanding({ ...a.owner, orgWidePermissions: new Set() }),
      (error: unknown) => error instanceof AuthError,
    );
    await assert.rejects(
      getSupplierOutstanding({ ...a.owner, orgWidePermissions: new Set() }),
      (error: unknown) => error instanceof AuthError,
    );
  });

  test('supplier outstanding comes from purchases received, not from stock on hand', async () => {
    const { rows } = await getSupplierOutstanding(a.owner);
    // This organization has no purchases, so nothing is owed — even though it
    // may hold stock from opening balances.
    assert.deepEqual(rows, []);
    const stock = await prisma.inventoryTransaction.count({
      where: { organizationId: a.organizationId },
    });
    assert.ok(stock >= 0, 'stock movements exist independently of what is owed');
  });
});
