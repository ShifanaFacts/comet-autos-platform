/**
 * Integration tests for leave, salaries and the monthly payroll run.
 *
 * The rules that matter: a person can't be on two overlapping leaves, only
 * someone who approves payroll can approve leave or pay, salary history only
 * moves forward, and a payroll line is exactly salary − unpaid leave, in fils,
 * frozen once approved.
 *
 *   npm run test:integration
 */
import 'dotenv/config';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/lib/prisma';
import { AuthError } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { localDateString } from '@/lib/format';
import {
  cancelLeave,
  decideLeave,
  leaveDays,
  listLeave,
  overlapDays,
  requestLeave,
} from '@/lib/hr/leave';
import {
  adjustDeduction,
  approvePayroll,
  cancelPayroll,
  getPayrollOverview,
  getPayrollRun,
  getSalaryHistory,
  markPayrollPaid,
  monthPeriod,
  recalculatePayroll,
  runPayroll,
  setSalary,
} from '@/lib/hr/payroll';
import { createTestOrg, expectDomainError, RUN, type TestOrg } from './support';

let a: TestOrg;
let b: TestOrg;
let tech: string;
let mate: string;

const d = (value: string) => new Date(`${value}T00:00:00Z`);

/** "YYYY-MM" for n months before this one. */
function monthsAgo(n: number) {
  const [year, month] = localDateString().split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 - n, 1)).toISOString().slice(0, 7);
}

const lastMonth = monthsAgo(1);
const twoMonthsAgo = monthsAgo(2);
const daysIn = (month: string) => leaveDays(monthPeriod(month).start, monthPeriod(month).end);

before(async () => {
  a = await createTestOrg('PayA');
  b = await createTestOrg('PayB');
  [tech, mate] = a.technicianIds;
});

after(async () => {
  await prisma.$disconnect();
});

describe('counting days', () => {
  test('leave days are calendar days, both ends included', () => {
    assert.equal(leaveDays(d('2026-03-03'), d('2026-03-05')), 3);
    assert.equal(leaveDays(d('2026-03-03'), d('2026-03-03')), 1);
  });

  test('overlap is clipped to the window, and zero when they do not meet', () => {
    assert.equal(overlapDays(d('2026-02-27'), d('2026-03-02'), d('2026-03-01'), d('2026-03-31')), 2);
    assert.equal(overlapDays(d('2026-02-01'), d('2026-02-10'), d('2026-03-01'), d('2026-03-31')), 0);
  });
});

describe('leave', () => {
  test('a request waits for approval, and an overlapping one is refused', async () => {
    const leave = await requestLeave(a.owner, {
      employeeId: tech,
      leaveType: 'ANNUAL',
      startDate: '2030-01-10',
      endDate: '2030-01-14',
      reason: 'Family visit',
      requestKey: `leave-1-${RUN}`,
    });
    assert.equal(leave.status, 'PENDING');

    await expectDomainError(
      requestLeave(a.owner, {
        employeeId: tech,
        leaveType: 'SICK',
        startDate: '2030-01-14',
        endDate: '2030-01-16',
      }),
      /overlaps requested leave/,
    );

    // Someone else may be off the same days.
    const other = await requestLeave(a.owner, {
      employeeId: mate,
      leaveType: 'ANNUAL',
      startDate: '2030-01-12',
      endDate: '2030-01-12',
    });
    assert.equal(other.status, 'PENDING');
  });

  test('the dates must run forwards', async () => {
    await expectDomainError(
      requestLeave(a.owner, {
        employeeId: tech,
        leaveType: 'ANNUAL',
        startDate: '2030-05-10',
        endDate: '2030-05-01',
      }),
      /before the first day/,
    );
  });

  test('approving needs payroll.approve, and is recorded against the approver', async () => {
    const leave = await requestLeave(a.owner, {
      employeeId: mate,
      leaveType: 'SICK',
      startDate: '2030-02-01',
      endDate: '2030-02-02',
    });
    await assert.rejects(decideLeave(a.viewer, leave.id, 'APPROVED'), AuthError);
    await decideLeave(a.owner, leave.id, 'APPROVED');
    const row = await prisma.leave.findUniqueOrThrow({ where: { id: leave.id } });
    assert.equal(row.status, 'APPROVED');
    assert.equal(row.approvedByUserId, a.owner.id);
    await expectDomainError(decideLeave(a.owner, leave.id, 'REJECTED'), /already approved/);
  });

  test('a rejected or cancelled leave frees the dates again', async () => {
    const first = await requestLeave(a.owner, {
      employeeId: mate,
      leaveType: 'OTHER',
      startDate: '2030-03-01',
      endDate: '2030-03-03',
    });
    await decideLeave(a.owner, first.id, 'REJECTED', { reason: 'Busy week' });
    const second = await requestLeave(a.owner, {
      employeeId: mate,
      leaveType: 'OTHER',
      startDate: '2030-03-02',
      endDate: '2030-03-02',
      approveNow: 'on',
    });
    assert.equal(second.status, 'APPROVED', 'an approver can record and approve in one step');
    await cancelLeave(a.owner, second.id, { reason: 'Plans changed' });
    const third = await requestLeave(a.owner, {
      employeeId: mate,
      leaveType: 'OTHER',
      startDate: '2030-03-02',
      endDate: '2030-03-02',
    });
    assert.equal(third.status, 'PENDING');
  });

  test('approve-now is ignored for someone who may not approve', async () => {
    const preparer = {
      ...a.owner,
      orgWidePermissions: new Set(['employee.view', 'leave.view', 'leave.create']),
    };
    const leave = await requestLeave(preparer, {
      employeeId: tech,
      leaveType: 'ANNUAL',
      startDate: '2030-04-01',
      endDate: '2030-04-01',
      approveNow: 'on',
    });
    assert.equal(leave.status, 'PENDING');
    await decideLeave(a.owner, leave.id, 'APPROVED');
    // Withdrawing approved leave takes the authority that approved it.
    await assert.rejects(cancelLeave(preparer, leave.id), AuthError);
  });

  test('another workshop can neither see nor decide it', async () => {
    const leave = await requestLeave(a.owner, {
      employeeId: tech,
      leaveType: 'ANNUAL',
      startDate: '2030-06-01',
      endDate: '2030-06-01',
    });
    await assert.rejects(decideLeave(b.owner, leave.id, 'APPROVED'), NotFoundError);
    const list = await listLeave(b.owner);
    assert.ok(list.rows.every((row) => row.id !== leave.id));
    await assert.rejects(
      requestLeave(b.owner, {
        employeeId: tech,
        leaveType: 'ANNUAL',
        startDate: '2030-07-01',
        endDate: '2030-07-01',
      }),
      NotFoundError,
    );
  });

  test('the list reports what is waiting', async () => {
    const list = await listLeave(a.owner, { status: 'PENDING' });
    assert.ok(list.rows.length > 0);
    assert.ok(list.rows.every((row) => row.status === 'PENDING'));
    assert.equal(list.totals.pending, list.rows.length);
  });
});

describe('salary', () => {
  test('pay is hidden from someone who only sees the team', async () => {
    const teamOnly = {
      ...a.owner,
      orgWidePermissions: new Set(['employee.view', 'attendance.view', 'leave.view']),
    };
    await assert.rejects(getSalaryHistory(teamOnly, tech), AuthError);
    await assert.rejects(getPayrollOverview(teamOnly), AuthError);
  });

  test('a new salary closes the previous one the day before', async () => {
    await setSalary(a.owner, tech, {
      basicSalary: '2800.00',
      allowances: '500',
      effectiveFrom: '2024-01-01',
    });
    await setSalary(a.owner, tech, {
      basicSalary: '3000.00',
      allowances: '600.00',
      effectiveFrom: '2025-01-01',
    });
    const history = await getSalaryHistory(a.owner, tech);
    assert.equal(history.history.length, 2);
    assert.equal(history.history[1].effectiveTo?.toISOString().slice(0, 10), '2024-12-31');
    assert.equal(history.current?.total, '3600.00');
  });

  test('history only moves forward; the same date corrects the row', async () => {
    await expectDomainError(
      setSalary(a.owner, tech, { basicSalary: '1.00', effectiveFrom: '2024-06-01' }),
      /on or after/,
    );
    await setSalary(a.owner, tech, {
      basicSalary: '3100.00',
      allowances: '600.00',
      effectiveFrom: '2025-01-01',
    });
    const history = await getSalaryHistory(a.owner, tech);
    assert.equal(history.history.length, 2, 'corrected in place, not added');
    assert.equal(history.current?.basicSalary.toString(), '3100');
  });
});

describe('payroll run', () => {
  let runId: string;

  test('lines come from salary less approved unpaid leave', async () => {
    const start = `${lastMonth}-03`;
    const end = `${lastMonth}-04`;
    await requestLeave(a.owner, {
      employeeId: tech,
      leaveType: 'UNPAID',
      startDate: start,
      endDate: end,
      approveNow: 'on',
    });

    const run = await runPayroll(a.owner, { month: lastMonth, requestKey: `payroll-${RUN}` });
    runId = run.id;
    assert.equal(run.status, 'CALCULATED');
    assert.deepEqual(run.missingSalary, ['Tech Two'], 'someone with no salary is reported, not paid');

    const detail = await getPayrollRun(a.owner, run.id);
    assert.equal(detail.lines.length, 1);
    const [line] = detail.lines;
    // 3700.00 a month, 2 unpaid days: 370000 × 2 / days, half-up, in fils.
    const days = daysIn(lastMonth);
    const expected = Math.floor((370000 * 2 * 2 + days) / (days * 2));
    assert.equal(line.deductions, (expected / 100).toFixed(2));
    assert.equal(line.netPay, ((370000 - expected) / 100).toFixed(2));
    assert.equal(line.unpaidLeaveDays, 2);
  });

  test('a month can only be run once, and never before it starts', async () => {
    await expectDomainError(runPayroll(a.owner, { month: lastMonth }), /already been run/);
    await expectDomainError(runPayroll(a.owner, { month: '2999-01' }), /hasn’t started/);
  });

  test('a deduction can be changed by hand, never above gross pay', async () => {
    const detail = await getPayrollRun(a.owner, runId);
    const [line] = detail.lines;
    await expectDomainError(
      adjustDeduction(a.owner, runId, line.id, { deductions: '99999.00', reason: 'Oops' }),
      /more than the gross pay/,
    );
    await adjustDeduction(a.owner, runId, line.id, { deductions: '100.00', reason: 'Advance' });
    const after = await getPayrollRun(a.owner, runId);
    assert.equal(after.lines[0].netPay, '3600.00');
    assert.equal(after.totals.net, '3600.00');
  });

  test('approving fixes the figures; paying needs the approver too', async () => {
    const preparer = {
      ...a.owner,
      orgWidePermissions: new Set(['payroll.view', 'payroll.create', 'payroll.edit']),
    };
    await assert.rejects(approvePayroll(preparer, runId), AuthError);
    await approvePayroll(a.owner, runId);
    await expectDomainError(recalculatePayroll(a.owner, runId), /can’t be recalculated/);
    const detail = await getPayrollRun(a.owner, runId);
    await expectDomainError(
      adjustDeduction(a.owner, runId, detail.lines[0].id, { deductions: '0', reason: 'Late' }),
      /can’t be changed/,
    );
    await markPayrollPaid(a.owner, runId);
    await expectDomainError(cancelPayroll(a.owner, runId, { reason: 'Mistake' }), /can’t be cancelled/);
    const paid = await getPayrollRun(a.owner, runId);
    assert.equal(paid.status, 'PAID');
    assert.equal(paid.paidBy, a.owner.fullName);
  });

  test('a cancelled month is reopened when it is run again', async () => {
    const run = await runPayroll(a.owner, { month: twoMonthsAgo });
    await cancelPayroll(a.owner, run.id, { reason: 'Salaries were wrong' });
    const again = await runPayroll(a.owner, { month: twoMonthsAgo });
    assert.equal(again.id, run.id, 'the same record, reopened');
    assert.equal(again.status, 'CALCULATED');
  });

  test('another workshop cannot open the run', async () => {
    await assert.rejects(getPayrollRun(b.owner, runId), NotFoundError);
    const overview = await getPayrollOverview(b.owner);
    assert.equal(overview.runs.length, 0);
  });
});
