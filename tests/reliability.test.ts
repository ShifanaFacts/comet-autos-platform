/**
 * Reliability: repeated submissions (double clicks, retries on a slow
 * network) are recorded once, server-side, and failures are explained
 * without internals.
 *
 *   npm run test:integration
 */
import 'dotenv/config';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { DuplicateSubmissionError, systemFailureMessage, toActionError } from '@/lib/errors';
import { checkInVehicle } from '@/lib/workshop/check-in';
import { startInspection, saveInspection } from '@/lib/workshop/inspection';
import { saveDiagnosis } from '@/lib/workshop/diagnosis';
import {
  createEstimate,
  recordCustomerDecision,
  saveEstimateDraft,
  sendEstimate,
} from '@/lib/workshop/estimates';
import { recordLabour, recordPartUsage, startRepair } from '@/lib/workshop/repair';
import { recordQualityCheck } from '@/lib/workshop/quality-check';
import { createInvoice, recordPayment } from '@/lib/billing/invoice';
import { createAppointment } from '@/lib/appointments/service';
import { adjustStock } from '@/lib/inventory/parts';
import { localDateString, toLocalDateTimeInput } from '@/lib/format';
import { createTestOrg, RUN, type TestOrg } from './support';

const key = () => randomBytes(16).toString('hex');
const PARTS = [{ sku: 'FLT-1', name: 'Oil filter', cost: '10', price: '25', stock: '20' }];

/** Runs the same call twice at the same moment, as a double click would. */
async function twice<T>(call: () => Promise<T>) {
  const results = await Promise.allSettled([call(), call()]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const duplicates = results.filter(
    (r) => r.status === 'rejected' && r.reason instanceof DuplicateSubmissionError,
  );
  const other = results.filter(
    (r) => r.status === 'rejected' && !(r.reason instanceof DuplicateSubmissionError),
  );
  return { fulfilled: fulfilled.length, duplicates: duplicates.length, other };
}

let org: TestOrg;
let jobCardId: string;
let vehicleId: string;
let labourLine: string;
let partLine: string;

before(async () => {
  org = await createTestOrg('Reliable', PARTS);
  ({ jobCardId } = await checkInVehicle(org.owner, {
    mode: 'new',
    customer: { name: 'Double Click', phone: '055 777 8899', email: '' },
    vehicle: { plateNumber: `R${RUN.slice(-4)} 11`, make: 'Kia', model: 'Sportage' },
    visit: { complaint: 'Service', mileage: '30000' },
  }));
  vehicleId = (await prisma.jobCard.findUniqueOrThrow({ where: { id: jobCardId } })).vehicleId;
  const inspection = await startInspection(org.owner, jobCardId, org.technicianIds[0]);
  await saveInspection(
    org.owner,
    inspection.id,
    { items: [{ description: 'Oil', result: 'ATTENTION_NEEDED', notes: 'Due' }] },
    { complete: true },
  );
  await saveDiagnosis(org.owner, jobCardId, {
    employeeId: org.technicianIds[0],
    findings: 'Service due',
    recommendedAction: 'Service',
  });
  const estimate = await createEstimate(org.owner, jobCardId);
  await saveEstimateDraft(org.owner, estimate.id, {
    validUntil: localDateString(new Date(Date.now() + 7 * 86400000)),
    items: [
      { itemType: 'LABOUR', description: 'Service', quantity: '2', unitPrice: '100' },
      { itemType: 'PART', description: 'Oil filter', quantity: '2', unitPrice: '25' },
    ],
  });
  await sendEstimate(org.owner, estimate.id);
  await recordCustomerDecision(org.owner, estimate.id, { decision: 'APPROVED', method: 'PHONE' });
  await startRepair(org.owner, jobCardId);
  const lines = await prisma.estimateItem.findMany({ where: { estimateId: estimate.id } });
  labourLine = lines.find((l) => l.itemType === 'LABOUR')!.id;
  partLine = lines.find((l) => l.itemType === 'PART')!.id;
});

after(async () => {
  await prisma.$disconnect();
});

describe('duplicate submissions are recorded once', () => {
  test('part usage: the same submission twice at once → one usage, one stock-out', async () => {
    const requestKey = key();
    const outcome = await twice(() =>
      recordPartUsage(org.owner, jobCardId, {
        partId: org.parts['FLT-1'].id,
        quantity: '1',
        employeeId: org.technicianIds[0],
        estimateItemId: partLine,
        requestKey,
      }),
    );
    assert.deepEqual([outcome.fulfilled, outcome.duplicates, outcome.other.length], [1, 1, 0]);
    assert.equal(await prisma.partUsage.count({ where: { jobCardId } }), 1);
    assert.equal(
      await prisma.inventoryTransaction.count({
        where: { organizationId: org.organizationId, transactionType: 'JOB_CONSUMPTION' },
      }),
      1,
    );
    // A genuinely new entry (new key) still goes through.
    await recordPartUsage(org.owner, jobCardId, {
      partId: org.parts['FLT-1'].id,
      quantity: '1',
      employeeId: org.technicianIds[0],
      estimateItemId: partLine,
      requestKey: key(),
    });
    assert.equal(await prisma.partUsage.count({ where: { jobCardId } }), 2);
  });

  test('labour: a repeat after the first finished is still recognised', async () => {
    const requestKey = key();
    const input = {
      employeeId: org.technicianIds[0],
      description: 'Service',
      hours: '2',
      rate: '100',
      estimateItemId: labourLine,
      requestKey,
    };
    await recordLabour(org.owner, jobCardId, input);
    await assert.rejects(recordLabour(org.owner, jobCardId, input), DuplicateSubmissionError);
    assert.equal(await prisma.labour.count({ where: { jobCardId } }), 1);
  });

  test('a failed attempt does not burn the key: the corrected retry is saved', async () => {
    const requestKey = key();
    await assert.rejects(
      recordLabour(org.owner, jobCardId, {
        employeeId: org.technicianIds[0],
        description: 'Wheel alignment',
        hours: '0',
        rate: '100',
        requestKey,
      }),
    );
    await recordLabour(org.owner, jobCardId, {
      employeeId: org.technicianIds[0],
      description: 'Wheel alignment',
      hours: '1',
      rate: '100',
      requestKey,
    });
    assert.equal(
      await prisma.labour.count({ where: { jobCardId, description: 'Wheel alignment' } }),
      1,
    );
  });

  test('payments: a double-clicked payment is taken once', async () => {
    await recordQualityCheck(org.owner, jobCardId, {
      employeeId: org.technicianIds[0],
      result: 'PASSED',
    });
    await createInvoice(org.owner, jobCardId);
    const requestKey = key();
    const outcome = await twice(() =>
      recordPayment(org.owner, jobCardId, {
        amount: '50',
        method: 'CASH',
        receivedAt: toLocalDateTimeInput(new Date()),
        requestKey,
      }),
    );
    assert.deepEqual([outcome.fulfilled, outcome.duplicates, outcome.other.length], [1, 1, 0]);
    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { jobCardId },
      include: { payments: true },
    });
    assert.equal(invoice.payments.length, 1);
    assert.equal(invoice.payments[0].amount.toString(), '50');
  });

  test('appointments and stock adjustments', async () => {
    const appointmentKey = key();
    const scheduledAt = toLocalDateTimeInput(new Date(Date.now() + 2 * 86400000));
    const outcome = await twice(() =>
      createAppointment(org.owner, {
        vehicleId,
        scheduledAt,
        estimatedDurationMinutes: '60',
        notes: 'Oil service',
        requestKey: appointmentKey,
      }),
    );
    assert.equal(outcome.fulfilled, 1);
    assert.equal(
      await prisma.appointment.count({ where: { organizationId: org.organizationId } }),
      1,
    );

    const adjustKey = key();
    const before = await prisma.inventoryTransaction.count({
      where: { organizationId: org.organizationId, transactionType: 'ADJUSTMENT' },
    });
    const adjust = await twice(() =>
      adjustStock(org.owner, org.parts['FLT-1'].id, {
        direction: 'OUT',
        quantity: '1',
        reason: 'DAMAGED',
        requestKey: adjustKey,
      }),
    );
    assert.equal(adjust.fulfilled, 1);
    assert.equal(
      await prisma.inventoryTransaction.count({
        where: { organizationId: org.organizationId, transactionType: 'ADJUSTMENT' },
      }),
      before + 1,
    );
  });

  test('check-in: a repeated check-in points at the job the first one opened', async () => {
    const other = await createTestOrg('ReliableCheckIn');
    const requestKey = key();
    const input = {
      mode: 'new' as const,
      customer: { name: 'Twice Customer', phone: '056 111 2233', email: '' },
      vehicle: { plateNumber: `T${RUN.slice(-4)} 22`, make: 'Honda', model: 'Civic' },
      visit: { complaint: 'Noise', mileage: '10000' },
      requestKey,
    };
    const first = await checkInVehicle(other.owner, input);
    await assert.rejects(checkInVehicle(other.owner, input), (error: unknown) => {
      assert.ok(error instanceof DuplicateSubmissionError);
      assert.equal(error.resultId, first.jobCardId);
      return true;
    });
    assert.equal(
      await prisma.jobCard.count({ where: { organizationId: other.organizationId } }),
      1,
    );
    assert.equal(
      await prisma.customer.count({ where: { organizationId: other.organizationId } }),
      1,
    );
  });

  test('keys are per user: a colleague reusing the same key is not blocked', async () => {
    const requestKey = key();
    const colleague = { ...org.owner, id: org.viewer.id };
    const scheduledAt = toLocalDateTimeInput(new Date(Date.now() + 3 * 86400000));
    await createAppointment(org.owner, { vehicleId, scheduledAt, notes: 'Brakes', requestKey });
    await createAppointment(colleague, { vehicleId, scheduledAt, notes: 'Brakes', requestKey });
    assert.equal(
      await prisma.requestKey.count({ where: { organizationId: org.organizationId, requestKey } }),
      2,
    );
  });
});

describe('failures are explained, never leaked', () => {
  test('a duplicate is reported as success, pointing at the first result', () => {
    assert.deepEqual(toActionError(new DuplicateSubmissionError('abc')), {
      ok: true,
      duplicate: true,
      duplicateOf: 'abc',
    });
  });

  test('database and unexpected failures get plain messages without internals', () => {
    const conflict = new Prisma.PrismaClientKnownRequestError(
      'Transaction failed due to a write conflict or a deadlock',
      { code: 'P2034', clientVersion: 'x' },
    );
    assert.match(
      systemFailureMessage(conflict),
      /Someone else changed this at the same moment\. Nothing was saved/,
    );
    const down = new Error('connect ECONNREFUSED 127.0.0.1:5433');
    assert.match(systemFailureMessage(down), /database can't be reached/);
    const timeout = new Prisma.PrismaClientKnownRequestError(
      'Timed out fetching a new connection',
      { code: 'P2024', clientVersion: 'x' },
    );
    assert.match(systemFailureMessage(timeout), /took too long/);
    const unknown = toActionError(
      new TypeError("Cannot read properties of undefined (reading 'id') at /src/lib/x.ts:12"),
    );
    assert.equal(unknown.ok, false);
    assert.match(unknown.error!, /Nothing was saved, and what you entered is still on the form/);
    assert.ok(!/undefined|\.ts|reading/.test(unknown.error!), 'no internals');
  });
});
