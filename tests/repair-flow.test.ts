/**
 * Integration tests for APPROVED → REPAIR → parts / labour → QUALITY CHECK →
 * READY, against the local PostgreSQL database through the real services.
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
import {
  createAdditionalEstimate,
  createEstimate,
  recordCustomerDecision,
  reviseEstimate,
  saveEstimateDraft,
  sendEstimate,
} from '@/lib/workshop/estimates';
import { getRepairWorkspace, recordLabour, recordPartUsage, startRepair } from '@/lib/workshop/repair';
import { recordQualityCheck } from '@/lib/workshop/quality-check';
import { transitionJobStatus } from '@/lib/workshop/job-status';
import { getStockOnHand } from '@/lib/inventory/stock';
import { localDateString } from '@/lib/format';
import { createTestOrg, expectDomainError, historyStatuses, jobStatus, RUN, type TestOrg } from './support';

const COMET_ORG = '00000000-0000-7000-8000-000000000001';
const PARTS = [
  { sku: 'AC-CLUTCH', name: 'AC compressor clutch', cost: '310.00', price: '480.00', stock: '2' },
  { sku: 'PADS', name: 'Brake pad set', cost: '95.00', price: '180.00', stock: '5' },
  { sku: 'OIL', name: 'Engine oil 1 L', cost: '18.00', price: '32.00', stock: '10' },
];

async function cometCounts() {
  const where = { organizationId: COMET_ORG };
  return {
    jobCards: await prisma.jobCard.count({ where }),
    estimates: await prisma.estimate.count({ where }),
    approvals: await prisma.approval.count({ where }),
    partUsages: await prisma.partUsage.count({ where }),
    labours: await prisma.labour.count({ where }),
    inventory: await prisma.inventoryTransaction.count({ where }),
    qualityChecks: await prisma.qualityCheck.count({ where }),
    history: await prisma.jobStatusHistory.count({ where }),
  };
}

/** Takes a fresh job from check-in to a sent estimate; optionally approves it. */
async function jobToEstimate(org: TestOrg, suffix: string, approve: boolean) {
  const { jobCardId } = await checkInVehicle(org.owner, {
    mode: 'new',
    customer: { name: `Repair Customer ${suffix}`, phone: `055 ${suffix.padStart(3, '0')} 4455` },
    vehicle: { plateNumber: `R${suffix} ${RUN.slice(-4)}`, make: 'Toyota', model: 'Camry' },
    visit: { complaint: 'AC not cooling, brakes squeal', mileage: '60000' },
  });
  const inspection = await startInspection(org.owner, jobCardId, org.technicianIds[0]);
  await saveInspection(org.owner, inspection.id, { items: [{ description: 'Air conditioning', result: 'FAILED', notes: 'Clutch dead' }] }, { complete: true });
  await saveDiagnosis(org.owner, jobCardId, {
    employeeId: org.technicianIds[0],
    findings: 'AC clutch coil open circuit; pads worn',
    recommendedAction: 'Replace AC clutch, replace front pads',
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
  if (approve) {
    await recordCustomerDecision(org.owner, estimate.id, { decision: 'APPROVED', method: 'PHONE' });
  }
  const lines = await prisma.estimateItem.findMany({ where: { estimateId: estimate.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  return {
    jobCardId,
    estimateId: estimate.id,
    labourLine: lines.find((l) => l.itemType === 'LABOUR')!.id,
    clutchLine: lines.find((l) => l.description === 'AC compressor clutch')!.id,
    padsLine: lines.find((l) => l.description === 'Front brake pads')!.id,
  };
}

let a: TestOrg;
let b: TestOrg;
let before_: Awaited<ReturnType<typeof cometCounts>>;

before(async () => {
  before_ = await cometCounts();
  a = await createTestOrg('RepairA', PARTS);
  b = await createTestOrg('RepairB', PARTS);
});

after(async () => {
  await prisma.$disconnect();
});

describe('repair → quality check → ready', () => {
  let job: Awaited<ReturnType<typeof jobToEstimate>>;
  let waiting: Awaited<ReturnType<typeof jobToEstimate>>;

  test('setup: one approved job, one still waiting approval', async () => {
    job = await jobToEstimate(a, '1', true);
    waiting = await jobToEstimate(a, '2', false);
    assert.equal(await jobStatus(job.jobCardId), 'APPROVED');
    assert.equal(await jobStatus(waiting.jobCardId), 'WAITING_APPROVAL');
  });

  test('2. an unapproved job cannot start repair', async () => {
    await expectDomainError(startRepair(a.owner, waiting.jobCardId), /approved the estimate/);
    await expectDomainError(
      prisma.$transaction((tx) => transitionJobStatus(tx, a.owner, job.jobCardId, 'REPAIR')),
      /Start the repair from the approved work/,
    );
    assert.equal(await jobStatus(waiting.jobCardId), 'WAITING_APPROVAL');
    // Parts / labour / QC are all refused before the repair has started.
    await expectDomainError(
      recordPartUsage(a.owner, job.jobCardId, { partId: a.parts['OIL'].id, quantity: '1', employeeId: a.technicianIds[0] }),
      /only be recorded while the job is in repair/,
    );
    await expectDomainError(
      recordQualityCheck(a.owner, job.jobCardId, { employeeId: a.technicianIds[0], result: 'PASSED' }),
      /only be done after the repair/,
    );
  });

  test('1. an approved job can start repair', async () => {
    await startRepair(a.owner, job.jobCardId);
    assert.equal(await jobStatus(job.jobCardId), 'REPAIR');
    assert.deepEqual((await historyStatuses(job.jobCardId)).slice(-2), ['APPROVED', 'REPAIR']);
    await expectDomainError(startRepair(a.owner, job.jobCardId), /only start on an approved job/);

    const repair = await getRepairWorkspace(a.owner, job.jobCardId);
    assert.equal(repair.approvedLines.length, 3);
    assert.equal(repair.remainingLines.length, 3);
  });

  test('3 + 4. part usage creates a PartUsage and a matching stock-out, with prices snapshotted', async () => {
    const usage = await recordPartUsage(a.owner, job.jobCardId, {
      partId: a.parts['AC-CLUTCH'].id,
      quantity: '1',
      employeeId: a.technicianIds[1],
      estimateItemId: job.clutchLine,
    });
    assert.equal(usage.unitCost.toString(), '310');
    assert.equal(usage.unitPrice.toString(), '480');
    assert.equal(usage.estimateItemId, job.clutchLine);

    const ledger = await prisma.inventoryTransaction.findMany({ where: { partUsageId: usage.id } });
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].transactionType, 'JOB_CONSUMPTION');
    assert.equal(ledger[0].quantity.toString(), '-1');
    assert.equal(ledger[0].unitCost?.toString(), '310');
    assert.equal(await getStockOnHand(prisma, a.organizationId, a.branchId, a.parts['AC-CLUTCH'].id), 1000, '2 → 1');

    // Changing the catalog price later never rewrites what was charged.
    await prisma.part.update({ where: { id: a.parts['AC-CLUTCH'].id }, data: { defaultSellingPrice: '999.00', defaultCostPrice: '500.00' } });
    const reread = await prisma.partUsage.findUniqueOrThrow({ where: { id: usage.id } });
    assert.equal(reread.unitPrice.toString(), '480');
    assert.equal(reread.unitCost.toString(), '310');

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: usage.id } });
    assert.equal(audit.action, 'part_usage.recorded');
  });

  test('5. part usage cannot make stock negative, and fails atomically', async () => {
    const usagesBefore = await prisma.partUsage.count({ where: { jobCardId: job.jobCardId } });
    const ledgerBefore = await prisma.inventoryTransaction.count({ where: { organizationId: a.organizationId } });
    await expectDomainError(
      recordPartUsage(a.owner, job.jobCardId, {
        partId: a.parts['AC-CLUTCH'].id,
        quantity: '2',
        employeeId: a.technicianIds[1],
        estimateItemId: job.clutchLine,
      }),
      /Only 1 in stock/,
    );
    assert.equal(await prisma.partUsage.count({ where: { jobCardId: job.jobCardId } }), usagesBefore, 'no PartUsage without its stock-out');
    assert.equal(await prisma.inventoryTransaction.count({ where: { organizationId: a.organizationId } }), ledgerBefore);
    assert.equal(await getStockOnHand(prisma, a.organizationId, a.branchId, a.parts['AC-CLUTCH'].id), 1000);

    for (const quantity of ['0', '-1', 'abc', '1.2345']) {
      await expectDomainError(
        recordPartUsage(a.owner, job.jobCardId, { partId: a.parts['OIL'].id, quantity, employeeId: a.technicianIds[0] }),
        /positive number/,
      );
    }
    // The database itself refuses a job consumption that adds stock.
    await assert.rejects(
      prisma.inventoryTransaction.create({
        data: {
          organizationId: a.organizationId,
          branchId: a.branchId,
          partId: a.parts['OIL'].id,
          transactionType: 'JOB_CONSUMPTION',
          quantity: '5',
        },
      }),
      /inventory_job_consumption_is_stock_out|check constraint/i,
    );
  });

  test('wrong approved line type and other jobs’ lines are rejected', async () => {
    await expectDomainError(
      recordPartUsage(a.owner, job.jobCardId, {
        partId: a.parts['PADS'].id,
        quantity: '1',
        employeeId: a.technicianIds[0],
        estimateItemId: job.labourLine,
      }),
      /labour, not a part/,
    );
    await expectDomainError(
      recordPartUsage(a.owner, job.jobCardId, {
        partId: a.parts['PADS'].id,
        quantity: '1',
        employeeId: a.technicianIds[0],
        estimateItemId: waiting.padsLine,
      }),
      /approved work/,
    );
  });

  test('6 + 7. labour is recorded and priced on the server', async () => {
    const labour = await recordLabour(a.owner, job.jobCardId, {
      employeeId: a.technicianIds[1],
      description: 'Replace AC compressor clutch',
      hours: '2.5',
      rate: '150',
      amount: '1.00', // ignored: the browser's total is never trusted
      estimateItemId: job.labourLine,
    } as Record<string, string>);
    assert.equal(labour.hours.toString(), '2.5');
    assert.equal(labour.rate.toString(), '150');
    assert.equal(labour.amount.toString(), '375');

    // Half-up rounding to the fil: 1.33 h × 99.99 = 132.9867 → 132.99
    const odd = await recordLabour(a.owner, job.jobCardId, {
      employeeId: a.technicianIds[1],
      description: 'Diagnostic re-check',
      hours: '1.33',
      rate: '99.99',
      estimateItemId: job.labourLine,
    });
    assert.equal(odd.amount.toString(), '132.99');

    for (const hours of ['0', '-1', 'x', '101', '1.234']) {
      await expectDomainError(
        recordLabour(a.owner, job.jobCardId, { employeeId: a.technicianIds[1], description: 'Test work', hours, rate: '100' }),
        /Hours|100 hours/,
      );
    }
    await expectDomainError(
      recordLabour(a.owner, job.jobCardId, { employeeId: a.technicianIds[1], description: 'Test work', hours: '1', rate: '-5' }),
      /Rate/,
    );
  });

  test('8. additional work is never silently added to the approved work', async () => {
    const before = await getRepairWorkspace(a.owner, job.jobCardId);

    // Work done without approval is recorded, but flagged and not counted as approved.
    await recordLabour(a.owner, job.jobCardId, {
      employeeId: a.technicianIds[0],
      description: 'Replace leaking water pump gasket',
      hours: '1',
      rate: '150',
    });
    let repair = await getRepairWorkspace(a.owner, job.jobCardId);
    assert.equal(repair.approvedLines.length, before.approvedLines.length);
    assert.equal(repair.totals.approved, before.totals.approved);
    assert.equal(repair.totals.labour, before.totals.labour, 'unapproved labour is not approved labour');
    assert.equal(repair.totals.unapproved, '150.00');

    // Request approval for it: a separate ADDITIONAL estimate; the job stays in repair.
    await expectDomainError(createEstimate(a.owner, job.jobCardId), /already has an estimate/);
    const additional = await createAdditionalEstimate(a.owner, job.jobCardId, { notes: 'Water pump gasket leaking' });
    assert.equal(additional.kind, 'ADDITIONAL');
    assert.equal(additional.version, 1);
    assert.notEqual(additional.estimateNumber, (await prisma.estimate.findUniqueOrThrow({ where: { id: job.estimateId } })).estimateNumber);
    await saveEstimateDraft(a.owner, additional.id, {
      validUntil: localDateString(new Date(Date.now() + 3 * 86400000)),
      items: [{ itemType: 'LABOUR', description: 'Replace water pump gasket', quantity: '1', unitPrice: '150' }],
    });
    await sendEstimate(a.owner, additional.id);
    assert.equal(await jobStatus(job.jobCardId), 'REPAIR');
    await expectDomainError(reviseEstimate(a.owner, additional.id), /not revised/);

    // The original approved quotation is untouched.
    const original = await prisma.estimate.findUniqueOrThrow({ where: { id: job.estimateId }, include: { items: true } });
    assert.equal(original.status, 'APPROVED');
    assert.equal(original.items.length, 3);

    // No quality check while the customer hasn't answered.
    await expectDomainError(
      recordQualityCheck(a.owner, job.jobCardId, { employeeId: a.technicianIds[0], result: 'PASSED' }),
      /waiting for customer approval/,
    );

    await recordCustomerDecision(a.owner, additional.id, { decision: 'APPROVED', method: 'PHONE' });
    assert.equal(await jobStatus(job.jobCardId), 'REPAIR', 'approving additional work does not move the job');
    repair = await getRepairWorkspace(a.owner, job.jobCardId);
    assert.equal(repair.approvedLines.length, 4, 'only now does it join the approved work');
    assert.ok(repair.approvedLines.some((l) => l.kind === 'ADDITIONAL'));
  });

  test('10 + 11. failed QC goes REPAIR → QUALITY_CHECK → REPAIR and is kept', async () => {
    await expectDomainError(
      recordQualityCheck(a.owner, job.jobCardId, { employeeId: a.technicianIds[0], result: 'FAILED' }),
      /what has to be corrected/,
    );
    const failed = await recordQualityCheck(a.owner, job.jobCardId, {
      employeeId: a.technicianIds[0],
      result: 'FAILED',
      correctionsRequired: 'Brake pedal soft — bleed front brakes',
      notes: 'Road test 5 km',
    });
    assert.equal(failed.status, 'FAILED');
    assert.equal(await jobStatus(job.jobCardId), 'REPAIR');
    assert.deepEqual((await historyStatuses(job.jobCardId)).slice(-2), ['QUALITY_CHECK', 'REPAIR']);

    // The database refuses a failed check with nothing to correct.
    await assert.rejects(
      prisma.qualityCheck.update({ where: { id: failed.id }, data: { correctionsRequired: '  ' } }),
      /quality_checks_failed_needs_corrections|check constraint/i,
    );
  });

  test('QC cannot pass while approved work is incomplete', async () => {
    // Front pads not fitted yet, and the approved additional line has no labour against it.
    const incomplete = (await getRepairWorkspace(a.owner, job.jobCardId)).remainingLines.map((l) => l.description);
    assert.ok(incomplete.includes('Front brake pads'));
    assert.ok(incomplete.includes('Replace water pump gasket'));
    await expectDomainError(
      recordQualityCheck(a.owner, job.jobCardId, { employeeId: a.technicianIds[1], result: 'PASSED' }),
      /approved work is incomplete: .*Front brake pads/,
    );
    assert.equal(await jobStatus(job.jobCardId), 'REPAIR', 'a refused pass changes nothing');
    assert.equal(await prisma.qualityCheck.count({ where: { jobCardId: job.jobCardId, status: 'PASSED' } }), 0);
    // Unapproved (additional) labour never completes an approved line.
    assert.ok((await getRepairWorkspace(a.owner, job.jobCardId)).labours.some((l) => l.estimateItemId === null));
  });

  test('9. passed QC moves REPAIR → QUALITY_CHECK → READY, history preserved', async () => {
    const additionalLine = (await getRepairWorkspace(a.owner, job.jobCardId)).approvedLines.find((l) => l.kind === 'ADDITIONAL')!;
    await recordLabour(a.owner, job.jobCardId, {
      employeeId: a.technicianIds[0],
      description: 'Replace water pump gasket',
      hours: '1',
      rate: '150',
      estimateItemId: additionalLine.id,
    });
    await recordPartUsage(a.owner, job.jobCardId, {
      partId: a.parts['PADS'].id,
      quantity: '1',
      employeeId: a.technicianIds[0],
      estimateItemId: job.padsLine,
    });
    const passed = await recordQualityCheck(a.owner, job.jobCardId, {
      employeeId: a.technicianIds[1],
      result: 'PASSED',
      notes: 'AC vent 6°C, brakes firm',
    });
    assert.equal(passed.status, 'PASSED');
    assert.equal(await jobStatus(job.jobCardId), 'READY');
    assert.equal((await getRepairWorkspace(a.owner, job.jobCardId)).remainingLines.length, 0);
    assert.deepEqual((await historyStatuses(job.jobCardId)).slice(-2), ['QUALITY_CHECK', 'READY']);

    const checks = await prisma.qualityCheck.findMany({ where: { jobCardId: job.jobCardId }, orderBy: { checkedAt: 'asc' } });
    assert.deepEqual(
      checks.map((c) => c.status),
      ['FAILED', 'PASSED'],
      'the failed check is not overwritten',
    );
    assert.ok(checks[0].correctionsRequired);
    const repair = await getRepairWorkspace(a.owner, job.jobCardId);
    assert.equal(repair.latestQualityCheck?.status, 'PASSED');
    const audits = await prisma.auditLog.findMany({ where: { entityType: 'QualityCheck', entityId: { in: checks.map((c) => c.id) } } });
    assert.deepEqual(audits.map((l) => l.action).sort(), ['quality_check.failed', 'quality_check.passed']);
  });

  test('13. invalid transitions after READY are rejected', async () => {
    await expectDomainError(
      recordPartUsage(a.owner, job.jobCardId, { partId: a.parts['OIL'].id, quantity: '1', employeeId: a.technicianIds[0] }),
      /while the job is in repair/,
    );
    await expectDomainError(
      recordLabour(a.owner, job.jobCardId, { employeeId: a.technicianIds[0], description: 'Late work', hours: '1', rate: '100' }),
      /while the job is in repair/,
    );
    await expectDomainError(
      recordQualityCheck(a.owner, job.jobCardId, { employeeId: a.technicianIds[0], result: 'PASSED' }),
      /only be done after the repair/,
    );
    await expectDomainError(prisma.$transaction((tx) => transitionJobStatus(tx, a.owner, job.jobCardId, 'REPAIR')), /can't move/);
    await expectDomainError(prisma.$transaction((tx) => transitionJobStatus(tx, a.owner, job.jobCardId, 'DELIVERED')), /can't move/);
    await expectDomainError(createAdditionalEstimate(a.owner, job.jobCardId, { notes: 'Too late for this' }), /while the job is in repair/);
  });

  test('12. other organizations and unauthorized users are rejected', async () => {
    const other = await jobToEstimate(b, '3', true);
    await startRepair(b.owner, other.jobCardId);

    // Org A can't touch org B's job, and B can't use A's parts or technicians.
    await expectDomainError(startRepair(a.owner, other.jobCardId), /could not be found/);
    await expectDomainError(
      recordPartUsage(a.owner, other.jobCardId, { partId: a.parts['OIL'].id, quantity: '1', employeeId: a.technicianIds[0] }),
      /could not be found/,
    );
    await expectDomainError(
      recordPartUsage(b.owner, other.jobCardId, { partId: a.parts['OIL'].id, quantity: '1', employeeId: b.technicianIds[0] }),
      /Choose a part from the inventory/,
    );
    await expectDomainError(
      recordLabour(b.owner, other.jobCardId, { employeeId: a.technicianIds[0], description: 'Test work', hours: '1', rate: '100' }),
      /Choose the technician/,
    );
    await expectDomainError(getRepairWorkspace(a.owner, other.jobCardId), /could not be found/);
    await expectDomainError(
      recordQualityCheck(a.owner, other.jobCardId, { employeeId: a.technicianIds[0], result: 'PASSED' }),
      /could not be found/,
    );

    // A viewer without edit / inventory.issue permission can look but not record.
    await assert.rejects(
      recordPartUsage(b.viewer, other.jobCardId, { partId: b.parts['OIL'].id, quantity: '1', employeeId: b.technicianIds[0] }),
      AuthError,
    );
    await assert.rejects(
      recordLabour(b.viewer, other.jobCardId, { employeeId: b.technicianIds[0], description: 'Test work', hours: '1', rate: '100' }),
      AuthError,
    );
    await assert.rejects(startRepair(b.viewer, other.jobCardId), AuthError);
    await getRepairWorkspace(b.viewer, other.jobCardId);
  });

  test('14. existing Comet Autos data is untouched', async () => {
    assert.deepEqual(await cometCounts(), before_);
  });
});
