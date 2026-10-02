/**
 * Integration tests for finishing a job without waiting for the money:
 *
 *  - a job is marked Completed from wherever the work stands, once;
 *  - it is handed over once invoiced — paid, or on credit when the staff
 *    member confirms it — and paid afterwards without reopening it;
 *  - never handed over without an invoice;
 *  - one check-in opens a job card for each of a customer's vehicles, each
 *    with its own mileage and, when it differs, its own work — and refuses
 *    another customer's vehicle or the same vehicle twice, opening nothing;
 *  - a job entered after the fact opens on the day the vehicle arrived,
 *    never in the future, and never winds the odometer back.
 *
 * Every record is made in a throwaway test organization.
 *
 *   npm run test:integration
 */
import 'dotenv/config';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/lib/prisma';
import { checkInVehicle } from '@/lib/workshop/check-in';
import { markJobCompleted } from '@/lib/workshop/job-status';
import { createDirectInvoice } from '@/lib/billing/direct-invoice';
import { deliverVehicle, recordInvoicePayment } from '@/lib/billing/invoice';
import { toLocalDateTimeInput } from '@/lib/format';
import { createTestOrg, expectDomainError, RUN, type TestOrg } from './support';

let a: TestOrg;
let customerId: string;
let vehicleIds: string[];
let otherCustomersVehicleId: string;

before(async () => {
  a = await createTestOrg('Completion');
  const customer = await prisma.customer.create({
    data: {
      organizationId: a.organizationId,
      name: `Fleet Customer ${RUN}`,
      phone: '050 111 2233',
    },
  });
  customerId = customer.id;
  vehicleIds = [];
  for (const [index, model] of ['Hiace', 'Corolla', 'Land Cruiser', 'Yaris', 'Camry'].entries()) {
    const vehicle = await prisma.vehicle.create({
      data: {
        organizationId: a.organizationId,
        customerId,
        plateNumber: `F${index} ${RUN.slice(-5)}`,
        make: 'Toyota',
        model,
      },
    });
    vehicleIds.push(vehicle.id);
  }
  const stranger = await prisma.customer.create({
    data: { organizationId: a.organizationId, name: `Someone else ${RUN}`, phone: '050 999 8877' },
  });
  otherCustomersVehicleId = (
    await prisma.vehicle.create({
      data: {
        organizationId: a.organizationId,
        customerId: stranger.id,
        plateNumber: `X9 ${RUN.slice(-5)}`,
        make: 'Nissan',
        model: 'Patrol',
      },
    })
  ).id;
});

after(async () => {
  await prisma.$disconnect();
});

const status = async (jobCardId: string) =>
  (await prisma.jobCard.findUniqueOrThrow({ where: { id: jobCardId } })).status;

describe("checking in several of a customer's vehicles", () => {
  test('one check-in opens a job card for each, with its own mileage and work', async () => {
    const result = await checkInVehicle(a.owner, {
      mode: 'existing',
      vehicleId: vehicleIds[0],
      visit: { complaint: 'Full service', mileage: '50000' },
      alsoVehicles: [
        { vehicleId: vehicleIds[1], mileage: '12000' },
        { vehicleId: vehicleIds[2], complaint: 'Replace front tyres' },
      ],
    });
    assert.equal(result.others?.length, 2);
    const jobs = await prisma.jobCard.findMany({
      where: { organizationId: a.organizationId, customerId },
      orderBy: { jobNumber: 'asc' },
    });
    assert.equal(jobs.length, 3);
    const byVehicle = new Map(jobs.map((job) => [job.vehicleId, job]));
    assert.equal(byVehicle.get(vehicleIds[1])?.customerComplaint, 'Full service', 'same work');
    assert.equal(byVehicle.get(vehicleIds[1])?.odometerReading, 12000);
    assert.equal(byVehicle.get(vehicleIds[2])?.customerComplaint, 'Replace front tyres');
    assert.equal(byVehicle.get(vehicleIds[2])?.odometerReading, null);
    assert.ok(jobs.every((job) => job.status === 'ARRIVED'));
    assert.equal(new Set(jobs.map((job) => job.jobNumber)).size, 3, 'each its own number');
  });

  test("another customer's vehicle, or the same one twice, is refused and nothing is opened", async () => {
    await expectDomainError(
      checkInVehicle(a.owner, {
        mode: 'existing',
        vehicleId: vehicleIds[3],
        visit: { complaint: 'Service' },
        alsoVehicles: [{ vehicleId: otherCustomersVehicleId }],
      }),
      /belongs to another customer/,
    );
    await expectDomainError(
      checkInVehicle(a.owner, {
        mode: 'existing',
        vehicleId: vehicleIds[3],
        visit: { complaint: 'Service' },
        alsoVehicles: [{ vehicleId: vehicleIds[3] }],
      }),
      /listed twice/,
    );
    await expectDomainError(
      checkInVehicle(a.owner, {
        mode: 'existing',
        vehicleId: vehicleIds[3],
        visit: { complaint: 'Service' },
        alsoVehicles: [{ vehicleId: vehicleIds[0] }],
      }),
      /already in the workshop/,
    );
    assert.equal(
      await prisma.jobCard.count({ where: { vehicleId: vehicleIds[3] } }),
      0,
      'the first vehicle was not checked in either',
    );
  });
});

describe('a job entered after the fact', () => {
  test('opens on the day the vehicle really arrived, with an older mileage', async () => {
    // A reading recorded since: the old job's lower mileage is still accepted.
    await prisma.vehicle.update({ where: { id: vehicleIds[3] }, data: { lastMileage: 80000 } });
    const { jobCardId } = await checkInVehicle(a.owner, {
      mode: 'existing',
      vehicleId: vehicleIds[3],
      visit: {
        complaint: 'Brake pads',
        mileage: '75000',
        arrivedOn: '2026-09-24',
        arrivedAt: '08:15',
      },
    });
    const job = await prisma.jobCard.findUniqueOrThrow({ where: { id: jobCardId } });
    assert.equal(job.openedAt.toISOString(), '2026-09-24T04:15:00.000Z', '08:15 Dubai time');
    assert.equal(job.odometerReading, 75000);
    const history = await prisma.jobStatusHistory.findFirstOrThrow({
      where: { jobCardId, toStatus: 'ARRIVED' },
    });
    assert.equal(history.changedAt.toISOString(), job.openedAt.toISOString());
    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleIds[3] } });
    assert.equal(vehicle.lastMileage, 80000, 'the odometer never goes backwards');
  });

  test('never in the future', async () => {
    await expectDomainError(
      checkInVehicle(a.owner, {
        mode: 'existing',
        vehicleId: otherCustomersVehicleId,
        visit: { complaint: 'Service', arrivedOn: '2999-01-01' },
      }),
      /future/,
    );
  });
});

describe('completing and delivering without the payment', () => {
  let jobCardId: string;

  test('a job is marked completed from where the work stands, once', async () => {
    ({ jobCardId } = await checkInVehicle(a.owner, {
      mode: 'existing',
      vehicleId: vehicleIds[4],
      visit: { complaint: 'Oil change' },
    }));
    await prisma.$transaction((tx) => markJobCompleted(tx, a.owner, jobCardId));
    assert.equal(await status(jobCardId), 'READY');
    const history = await prisma.jobStatusHistory.findFirstOrThrow({
      where: { jobCardId, toStatus: 'READY' },
    });
    assert.equal(history.changedByUserId, a.owner.id);
    await expectDomainError(
      prisma.$transaction((tx) => markJobCompleted(tx, a.owner, jobCardId)),
      /already completed/,
    );
  });

  test('never handed over without an invoice', async () => {
    await expectDomainError(
      deliverVehicle(a.owner, jobCardId, { onCredit: 'true' }),
      /Create the invoice before/,
    );
  });

  test('invoiced and unpaid: delivered on credit once confirmed, then paid', async () => {
    const { invoiceId } = await createDirectInvoice(a.owner, {
      customerId,
      jobCardId,
      items: [{ itemType: 'LABOUR', description: 'Oil change', quantity: '1', unitPrice: '100' }],
    });
    assert.equal(await status(jobCardId), 'INVOICED');

    await expectDomainError(deliverVehicle(a.owner, jobCardId, {}), /105\.00 is still owed/);
    await deliverVehicle(a.owner, jobCardId, { onCredit: 'true', notes: 'Fleet account' });
    assert.equal(await status(jobCardId), 'DELIVERED');
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: jobCardId, action: 'job_card.delivered' },
    });
    assert.equal((audit.afterData as { onCredit?: boolean }).onCredit, true);
    let invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    assert.equal(invoice.status, 'ISSUED', 'still owed');

    await recordInvoicePayment(a.owner, invoiceId, {
      amount: '105',
      method: 'BANK_TRANSFER',
      receivedAt: toLocalDateTimeInput(new Date()),
    });
    invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    assert.equal(invoice.status, 'PAID');
    assert.equal(await status(jobCardId), 'DELIVERED', 'paying later does not reopen the job');

    await expectDomainError(
      prisma.$transaction((tx) => markJobCompleted(tx, a.owner, jobCardId)),
      /can't be marked completed/,
    );
    await expectDomainError(deliverVehicle(a.owner, jobCardId, {}), /already been delivered/);
  });
});
