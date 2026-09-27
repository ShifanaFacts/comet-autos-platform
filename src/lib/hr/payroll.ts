import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import type { PayrollStatus } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { AuthError, hasPermission, requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { DomainError, NotFoundError } from '@/lib/errors';
import { parseInput } from '@/lib/form-data';
import { claimRequestKey, settleRequestKey } from '@/lib/request-keys';
import { filsToString, toFils } from '@/lib/money';
import { localDateString, parseCalendarDate } from '@/lib/format';
import { approvedLeaveDays, leaveDays, overlapDays } from '@/lib/hr/leave';

/*
 * Salaries and the monthly payroll run.
 *
 * SALARY. Each employee's pay is a history of rows (basic + allowances, from
 * a date). Setting a new salary closes the open row the day before the new
 * one starts, so there is always exactly one salary in force on any day.
 * History only moves forward; the same start date corrects that row.
 *
 * PAYROLL. One run per calendar month for the whole organization — the
 * database holds that (`@@unique([organizationId, periodStart, periodEnd])`).
 *
 *     calculate ─▶ CALCULATED ─approve─▶ APPROVED ─pay─▶ PAID
 *          ▲            │                   │
 *          └─recalculate┘      cancel ──▶ CANCELLED (reopened by running
 *                                          the same month again)
 *
 * Each line snapshots what was paid, so changing someone's salary later
 * never rewrites a month already run. The rules for a line, in fils:
 *
 *   salary     the row in force on the last day of the month
 *   pro-rated  by calendar days employed in the month (joined or left
 *              mid-month); a full month is never pro-rated
 *   deduction  approved UNPAID leave days × (basic + allowances) / days in
 *              the month; editable with a reason while CALCULATED
 *   net        basic + allowances − deductions, never below zero
 *
 * Absent days from attendance are shown beside each line but are not
 * deducted automatically — whether an absence is docked is the manager's
 * call, made with the deduction edit.
 *
 * Who may see pay: anyone who prepares payroll (`payroll.create`) or signs
 * it off (`payroll.approve`). `payroll.view` alone is the team directory,
 * attendance and leave — not what people earn.
 */

export const PAYROLL_STATUS_LABEL: Record<PayrollStatus, string> = {
  DRAFT: 'Draft',
  CALCULATED: 'Ready for approval',
  APPROVED: 'Approved — to pay',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
};

/** Whether this user may see salary figures at all. */
export function canSeePay(user: AuthenticatedUser) {
  return hasPermission(user, 'payroll.create') || hasPermission(user, 'payroll.approve');
}

function requirePayAccess(user: AuthenticatedUser) {
  if (!canSeePay(user)) throw new AuthError('Missing permission: payroll.create');
}

const DAY_MS = 86_400_000;
const MONEY = /^\d{1,9}(\.\d{1,2})?$/;

/** Half-up rounding of a non-negative integer ratio. */
const divRound = (numerator: number, denominator: number) =>
  Math.floor((numerator * 2 + denominator) / (denominator * 2));

const name = (employee: { firstName: string; lastName: string }) =>
  `${employee.firstName} ${employee.lastName}`.trim();

const fils = (value: { toString(): string } | null | undefined) =>
  value ? toFils(value.toString()) : 0;

/** "2026-03" → the month's first and last calendar dates. */
export function monthPeriod(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new DomainError('Choose a month.', 'month');
  }
  const [year, index] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, index - 1, 1));
  const end = new Date(Date.UTC(year, index, 0));
  return { start, end };
}

/** "March 2026". */
export function monthLabel(date: Date) {
  return date.toLocaleDateString('en-AE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

async function audit(
  tx: Prisma.TransactionClient,
  user: AuthenticatedUser,
  action: string,
  entityType: 'Salary' | 'Payroll',
  entityId: string,
  afterData: Record<string, unknown>,
  beforeData?: Record<string, unknown>,
  metadata?: Record<string, unknown>,
) {
  await writeAuditLog(tx, {
    organizationId: user.organizationId,
    actorUserId: user.id,
    action,
    entityType,
    entityId,
    beforeData,
    afterData,
    metadata,
  });
}

// ─── Salary ─────────────────────────────────────────────────────────────────

const salarySchema = z.object({
  basicSalary: z
    .string({ error: 'Enter the basic salary.' })
    .trim()
    .regex(MONEY, 'Enter an amount like 3500.00.'),
  allowances: z
    .union([z.literal(''), z.string().trim().regex(MONEY, 'Enter an amount like 500.00.')])
    .optional(),
  effectiveFrom: z
    .string({ error: 'Choose the date it starts.' })
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the date it starts.'),
  requestKey: z.string().optional(),
});

/**
 * Sets an employee's pay from a date. Closes the salary in force the day
 * before; the same start date as the latest row corrects that row instead.
 */
export async function setSalary(user: AuthenticatedUser, employeeId: string, rawInput: unknown) {
  const input = parseInput(salarySchema, rawInput);
  requirePermission(user, 'payroll.create');
  const from = parseCalendarDate(input.effectiveFrom);
  if (!from) throw new DomainError('Choose the date it starts.', 'effectiveFrom');
  const basic = toFils(input.basicSalary);
  const allowances = input.allowances ? toFils(input.allowances) : 0;
  if (basic <= 0) throw new DomainError('The basic salary must be more than zero.', 'basicSalary');

  return prisma.$transaction(async (tx) => {
    await claimRequestKey(tx, user, rawInput, 'salary.set');
    const employee = await tx.employee.findFirst({
      where: { id: employeeId, organizationId: user.organizationId },
      select: { id: true, branchId: true, hireDate: true },
    });
    if (!employee) throw new NotFoundError('employee');

    const latest = await tx.salary.findFirst({
      where: { organizationId: user.organizationId, employeeId },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (latest && from < latest.effectiveFrom) {
      throw new DomainError(
        `The current salary starts on ${latest.effectiveFrom.toISOString().slice(0, 10)}. A change has to start on or after that date.`,
        'effectiveFrom',
      );
    }

    const data = {
      basicSalary: filsToString(basic),
      allowances: filsToString(allowances),
    };

    if (latest && from.getTime() === latest.effectiveFrom.getTime()) {
      const salary = await tx.salary.update({ where: { id: latest.id }, data });
      await audit(
        tx,
        user,
        'salary.corrected',
        'Salary',
        salary.id,
        { employeeId, ...data, effectiveFrom: input.effectiveFrom },
        { basicSalary: latest.basicSalary.toString(), allowances: latest.allowances.toString() },
      );
      await settleRequestKey(tx, user, rawInput, salary.id);
      return salary;
    }

    if (latest && !latest.effectiveTo) {
      await tx.salary.update({
        where: { id: latest.id },
        data: { effectiveTo: new Date(from.getTime() - DAY_MS) },
      });
    }
    const salary = await tx.salary.create({
      data: {
        organizationId: user.organizationId,
        employeeId,
        ...data,
        effectiveFrom: from,
      },
    });
    await audit(
      tx,
      user,
      'salary.set',
      'Salary',
      salary.id,
      { employeeId, ...data, effectiveFrom: input.effectiveFrom },
      latest
        ? { basicSalary: latest.basicSalary.toString(), allowances: latest.allowances.toString() }
        : undefined,
    );
    await settleRequestKey(tx, user, rawInput, salary.id);
    return salary;
  });
}

/** One employee's pay history, newest first, with the salary in force today. */
export async function getSalaryHistory(user: AuthenticatedUser, employeeId: string) {
  requirePayAccess(user);
  const rows = await prisma.salary.findMany({
    where: { organizationId: user.organizationId, employeeId },
    orderBy: { effectiveFrom: 'desc' },
  });
  const today = parseCalendarDate(localDateString())!;
  const current =
    rows.find(
      (row) => row.effectiveFrom <= today && (!row.effectiveTo || row.effectiveTo >= today),
    ) ?? null;
  return {
    current: current ? withTotal(current) : null,
    /** A salary set to start later than today. */
    upcoming: rows.find((row) => row.effectiveFrom > today) ?? null,
    history: rows.map(withTotal),
  };
}

function withTotal<
  T extends { basicSalary: { toString(): string }; allowances: { toString(): string } },
>(row: T) {
  return { ...row, total: filsToString(fils(row.basicSalary) + fils(row.allowances)) };
}

// ─── Calculating a month ────────────────────────────────────────────────────

interface CalculatedLine {
  employeeId: string;
  basicSalary: string;
  allowances: string;
  deductions: string;
  netPay: string;
}

/**
 * Every line for one month, from the salaries, employment dates and
 * approved unpaid leave. Four queries for the whole team.
 */
async function calculateLines(
  tx: Prisma.TransactionClient,
  organizationId: string,
  start: Date,
  end: Date,
) {
  const employees = await tx.employee.findMany({
    where: {
      organizationId,
      hireDate: { lte: end },
      // Someone who left is paid for the part of the month they worked; an
      // inactive record with no leaving date is not paid at all.
      OR: [{ isActive: true, terminationDate: null }, { terminationDate: { gte: start } }],
    },
    select: { id: true, firstName: true, lastName: true, hireDate: true, terminationDate: true },
  });
  const ids = employees.map((employee) => employee.id);
  const [salaries, leave] = await Promise.all([
    tx.salary.findMany({
      where: { organizationId, employeeId: { in: ids }, effectiveFrom: { lte: end } },
      orderBy: { effectiveFrom: 'desc' },
    }),
    approvedLeaveDays(tx, organizationId, ids, start, end),
  ]);

  const salaryOf = new Map<string, (typeof salaries)[number]>();
  for (const salary of salaries) {
    if (!salaryOf.has(salary.employeeId)) salaryOf.set(salary.employeeId, salary);
  }

  const days = leaveDays(start, end);
  const lines: CalculatedLine[] = [];
  const missingSalary: string[] = [];

  for (const employee of employees) {
    const salary = salaryOf.get(employee.id);
    if (!salary) {
      missingSalary.push(name(employee));
      continue;
    }
    const employed = overlapDays(employee.hireDate, employee.terminationDate ?? end, start, end);
    if (employed === 0) continue;

    const monthlyBasic = fils(salary.basicSalary);
    const monthlyAllowances = fils(salary.allowances);
    const basic = employed === days ? monthlyBasic : divRound(monthlyBasic * employed, days);
    const allowances =
      employed === days ? monthlyAllowances : divRound(monthlyAllowances * employed, days);
    const unpaid = Math.min(leave.get(employee.id)?.UNPAID ?? 0, employed);
    const deductions = Math.min(
      divRound((monthlyBasic + monthlyAllowances) * unpaid, days),
      basic + allowances,
    );
    lines.push({
      employeeId: employee.id,
      basicSalary: filsToString(basic),
      allowances: filsToString(allowances),
      deductions: filsToString(deductions),
      netPay: filsToString(basic + allowances - deductions),
    });
  }
  return { lines, missingSalary };
}

function totalsOf(
  items: {
    basicSalary: { toString(): string };
    allowances: { toString(): string };
    deductions: { toString(): string };
    netPay: { toString(): string };
  }[],
) {
  let gross = 0;
  let deductions = 0;
  let net = 0;
  for (const item of items) {
    gross += fils(item.basicSalary) + fils(item.allowances);
    deductions += fils(item.deductions);
    net += fils(item.netPay);
  }
  return {
    count: items.length,
    gross: filsToString(gross),
    deductions: filsToString(deductions),
    net: filsToString(net),
    netFils: net,
  };
}

const monthSchema = z.object({
  month: z.string({ error: 'Choose a month.' }).trim(),
  requestKey: z.string().optional(),
});

/**
 * Runs payroll for a month: calculates every line and leaves the run ready
 * for approval. Running a month whose earlier run was cancelled reopens
 * that run — the database allows one run per month, and the audit trail
 * keeps the whole story on the one record.
 */
export async function runPayroll(user: AuthenticatedUser, rawInput: unknown) {
  const input = parseInput(monthSchema, rawInput);
  requirePermission(user, 'payroll.create');
  const { start, end } = monthPeriod(input.month);
  if (input.month > localDateString().slice(0, 7)) {
    throw new DomainError('Payroll can’t be run for a month that hasn’t started.', 'month');
  }

  return prisma.$transaction(async (tx) => {
    await claimRequestKey(tx, user, rawInput, 'payroll.run');
    const existing = await tx.payroll.findFirst({
      where: { organizationId: user.organizationId, periodStart: start, periodEnd: end },
      select: { id: true, status: true },
    });
    if (existing && existing.status !== 'CANCELLED') {
      throw new DomainError(
        `${monthLabel(start)} has already been run. Open it from the list to review it.`,
        'month',
      );
    }

    const { lines, missingSalary } = await calculateLines(tx, user.organizationId, start, end);
    if (lines.length === 0) {
      throw new DomainError(
        missingSalary.length
          ? `No one has a salary set for ${monthLabel(start)}. Set salaries on each employee's page first.`
          : `No one was employed in ${monthLabel(start)}.`,
        'month',
      );
    }

    const now = new Date();
    const payroll = existing
      ? await tx.payroll.update({
          where: { id: existing.id },
          data: {
            status: 'CALCULATED',
            calculatedAt: now,
            approvedAt: null,
            approvedByUserId: null,
            paidAt: null,
            paidByUserId: null,
          },
        })
      : await tx.payroll.create({
          data: {
            organizationId: user.organizationId,
            periodStart: start,
            periodEnd: end,
            status: 'CALCULATED',
            calculatedAt: now,
            createdByUserId: user.id,
          },
        });
    if (existing) await tx.payrollItem.deleteMany({ where: { payrollId: payroll.id } });
    await tx.payrollItem.createMany({
      data: lines.map((line) => ({
        organizationId: user.organizationId,
        payrollId: payroll.id,
        ...line,
      })),
    });
    const totals = totalsOf(lines);
    await audit(
      tx,
      user,
      existing ? 'payroll.reopened' : 'payroll.calculated',
      'Payroll',
      payroll.id,
      { month: input.month, employees: totals.count, gross: totals.gross, net: totals.net },
      existing ? { status: 'CANCELLED' } : undefined,
      missingSalary.length ? { missingSalary } : undefined,
    );
    await settleRequestKey(tx, user, rawInput, payroll.id);
    return { ...payroll, missingSalary };
  });
}

/** Loads a run for changing, confirming it is in one of the allowed states. */
async function loadRun(
  tx: Prisma.TransactionClient,
  user: AuthenticatedUser,
  payrollId: string,
  allowed: PayrollStatus[],
  verb: string,
) {
  const payroll = await tx.payroll.findFirst({
    where: { id: payrollId, organizationId: user.organizationId },
  });
  if (!payroll) throw new NotFoundError('payroll run');
  if (!allowed.includes(payroll.status)) {
    throw new DomainError(
      `This payroll is ${PAYROLL_STATUS_LABEL[payroll.status].toLowerCase()}, so it can’t be ${verb}.`,
    );
  }
  return payroll;
}

/** Moves a run on, guarded on the status it was read in, so two people can't both win. */
async function transition(
  tx: Prisma.TransactionClient,
  payrollId: string,
  from: PayrollStatus,
  data: Prisma.PayrollUncheckedUpdateManyInput,
) {
  const updated = await tx.payroll.updateMany({ where: { id: payrollId, status: from }, data });
  if (updated.count === 0) throw new DomainError('Someone else changed this payroll just now.');
}

/**
 * Recalculates a run that has not been approved — after a salary was
 * corrected or leave approved late. Any hand-edited deductions are replaced.
 */
export async function recalculatePayroll(user: AuthenticatedUser, payrollId: string) {
  requirePermission(user, 'payroll.create');
  return prisma.$transaction(async (tx) => {
    const payroll = await loadRun(tx, user, payrollId, ['DRAFT', 'CALCULATED'], 'recalculated');
    const before = totalsOf(await tx.payrollItem.findMany({ where: { payrollId: payroll.id } }));
    const { lines, missingSalary } = await calculateLines(
      tx,
      user.organizationId,
      payroll.periodStart,
      payroll.periodEnd,
    );
    if (lines.length === 0) {
      throw new DomainError('No one has a salary for this month, so there is nothing to pay.');
    }
    await transition(tx, payroll.id, payroll.status, {
      status: 'CALCULATED',
      calculatedAt: new Date(),
    });
    await tx.payrollItem.deleteMany({ where: { payrollId: payroll.id } });
    await tx.payrollItem.createMany({
      data: lines.map((line) => ({
        organizationId: user.organizationId,
        payrollId: payroll.id,
        ...line,
      })),
    });
    const after = totalsOf(lines);
    await audit(
      tx,
      user,
      'payroll.recalculated',
      'Payroll',
      payroll.id,
      { employees: after.count, gross: after.gross, net: after.net },
      { employees: before.count, gross: before.gross, net: before.net },
      missingSalary.length ? { missingSalary } : undefined,
    );
    return { id: payroll.id, missingSalary };
  });
}

const adjustSchema = z.object({
  deductions: z
    .string({ error: 'Enter the deduction.' })
    .trim()
    .regex(MONEY, 'Enter an amount like 150.00.'),
  reason: z
    .string({ error: 'Say why the deduction is changing.' })
    .trim()
    .min(3, 'Say why the deduction is changing.')
    .max(300),
  requestKey: z.string().optional(),
});

/** Sets one line's deduction by hand, with a reason, before the run is approved. */
export async function adjustDeduction(
  user: AuthenticatedUser,
  payrollId: string,
  itemId: string,
  rawInput: unknown,
) {
  const input = parseInput(adjustSchema, rawInput);
  requirePermission(user, 'payroll.create');
  const deduction = toFils(input.deductions);

  return prisma.$transaction(async (tx) => {
    const payroll = await loadRun(tx, user, payrollId, ['CALCULATED'], 'changed');
    const item = await tx.payrollItem.findFirst({
      where: { id: itemId, payrollId: payroll.id, organizationId: user.organizationId },
    });
    if (!item) throw new NotFoundError('payroll line');
    const gross = fils(item.basicSalary) + fils(item.allowances);
    if (deduction > gross) {
      throw new DomainError(
        `The deduction can’t be more than the gross pay of ${filsToString(gross)}.`,
        'deductions',
      );
    }
    const updated = await tx.payrollItem.update({
      where: { id: item.id },
      data: { deductions: filsToString(deduction), netPay: filsToString(gross - deduction) },
    });
    await audit(
      tx,
      user,
      'payroll.deduction_adjusted',
      'Payroll',
      payroll.id,
      {
        employeeId: item.employeeId,
        deductions: filsToString(deduction),
        netPay: updated.netPay.toString(),
      },
      { deductions: item.deductions.toString(), netPay: item.netPay.toString() },
      { reason: input.reason },
    );
    return updated;
  });
}

/** Signs a calculated run off. From here the figures are fixed. */
export async function approvePayroll(user: AuthenticatedUser, payrollId: string) {
  requirePermission(user, 'payroll.approve');
  return prisma.$transaction(async (tx) => {
    const payroll = await loadRun(tx, user, payrollId, ['CALCULATED'], 'approved');
    const items = await tx.payrollItem.findMany({ where: { payrollId: payroll.id } });
    if (items.length === 0) throw new DomainError('There is no one on this payroll to approve.');
    await transition(tx, payroll.id, 'CALCULATED', {
      status: 'APPROVED',
      approvedByUserId: user.id,
      approvedAt: new Date(),
    });
    const totals = totalsOf(items);
    await audit(
      tx,
      user,
      'payroll.approved',
      'Payroll',
      payroll.id,
      { status: 'APPROVED', net: totals.net },
      { status: 'CALCULATED' },
    );
    return { id: payroll.id };
  });
}

/** Records that an approved run has been paid out. */
export async function markPayrollPaid(user: AuthenticatedUser, payrollId: string) {
  requirePermission(user, 'payroll.approve');
  return prisma.$transaction(async (tx) => {
    const payroll = await loadRun(tx, user, payrollId, ['APPROVED'], 'marked as paid');
    const paidAt = new Date();
    await transition(tx, payroll.id, 'APPROVED', {
      status: 'PAID',
      paidByUserId: user.id,
      paidAt,
    });
    await audit(
      tx,
      user,
      'payroll.paid',
      'Payroll',
      payroll.id,
      { status: 'PAID', paidAt: paidAt.toISOString() },
      { status: 'APPROVED' },
    );
    return { id: payroll.id };
  });
}

const cancelSchema = z.object({
  reason: z
    .string({ error: 'Say why this payroll is being cancelled.' })
    .trim()
    .min(3, 'Say why this payroll is being cancelled.')
    .max(300),
  requestKey: z.string().optional(),
});

/**
 * Abandons a run before it is paid. An approved run needs the authority that
 * approved it. A paid run is history and can't be cancelled.
 */
export async function cancelPayroll(user: AuthenticatedUser, payrollId: string, rawInput: unknown) {
  const input = parseInput(cancelSchema, rawInput);
  requirePermission(user, 'payroll.create');
  return prisma.$transaction(async (tx) => {
    const payroll = await loadRun(
      tx,
      user,
      payrollId,
      ['DRAFT', 'CALCULATED', 'APPROVED'],
      'cancelled',
    );
    if (payroll.status === 'APPROVED') requirePermission(user, 'payroll.approve');
    await transition(tx, payroll.id, payroll.status, { status: 'CANCELLED' });
    await audit(
      tx,
      user,
      'payroll.cancelled',
      'Payroll',
      payroll.id,
      { status: 'CANCELLED' },
      { status: payroll.status },
      { reason: input.reason },
    );
    return { id: payroll.id };
  });
}

// ─── Reading ────────────────────────────────────────────────────────────────

/** The runs, newest month first, and who on the team has no salary yet. */
export async function getPayrollOverview(user: AuthenticatedUser) {
  requirePayAccess(user);
  const organizationId = user.organizationId;
  const today = parseCalendarDate(localDateString())!;

  const [runs, employees] = await Promise.all([
    prisma.payroll.findMany({
      where: { organizationId },
      orderBy: { periodStart: 'desc' },
      take: 36,
      include: {
        items: { select: { basicSalary: true, allowances: true, deductions: true, netPay: true } },
        approvedBy: { select: { fullName: true } },
        paidBy: { select: { fullName: true } },
      },
    }),
    prisma.employee.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        jobTitle: true,
        salaries: {
          where: { effectiveFrom: { lte: today } },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
          select: { basicSalary: true, allowances: true, effectiveFrom: true },
        },
      },
    }),
  ]);

  const team = employees.map((employee) => {
    const salary = employee.salaries[0] ?? null;
    return {
      id: employee.id,
      name: name(employee),
      code: employee.employeeCode,
      jobTitle: employee.jobTitle,
      salary: salary ? withTotal(salary) : null,
    };
  });
  const monthlyFils = team.reduce(
    (sum, member) => sum + (member.salary ? toFils(member.salary.total) : 0),
    0,
  );

  // Offer the current month unless it has a live run; then the month after the latest.
  const thisMonth = localDateString().slice(0, 7);
  const taken = new Set(
    runs
      .filter((run) => run.status !== 'CANCELLED')
      .map((run) => run.periodStart.toISOString().slice(0, 7)),
  );

  return {
    runs: runs.map((run) => ({
      id: run.id,
      month: run.periodStart.toISOString().slice(0, 7),
      label: monthLabel(run.periodStart),
      status: run.status,
      approvedBy: run.approvedBy?.fullName ?? null,
      approvedAt: run.approvedAt,
      paidBy: run.paidBy?.fullName ?? null,
      paidAt: run.paidAt,
      totals: totalsOf(run.items),
    })),
    team,
    monthly: filsToString(monthlyFils),
    missingSalary: team.filter((member) => !member.salary).length,
    suggestedMonth: taken.has(thisMonth) ? null : thisMonth,
    thisMonth,
  };
}

export type PayrollOverview = Awaited<ReturnType<typeof getPayrollOverview>>;

/** One run with every line, and the leave and absence behind each. */
export async function getPayrollRun(user: AuthenticatedUser, payrollId: string) {
  requirePayAccess(user);
  const payroll = await prisma.payroll.findFirst({
    where: { id: payrollId, organizationId: user.organizationId },
    include: {
      createdBy: { select: { fullName: true } },
      approvedBy: { select: { fullName: true } },
      paidBy: { select: { fullName: true } },
      items: {
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              jobTitle: true,
            },
          },
        },
      },
    },
  });
  if (!payroll) throw new NotFoundError('payroll run');

  const ids = payroll.items.map((item) => item.employeeId);
  const [leave, absences] = await Promise.all([
    approvedLeaveDays(prisma, user.organizationId, ids, payroll.periodStart, payroll.periodEnd),
    prisma.attendance.groupBy({
      by: ['employeeId'],
      where: {
        organizationId: user.organizationId,
        employeeId: { in: ids },
        status: 'ABSENT',
        attendanceDate: { gte: payroll.periodStart, lte: payroll.periodEnd },
      },
      _count: { _all: true },
    }),
  ]);
  const absent = new Map(absences.map((row) => [row.employeeId, row._count._all]));

  const lines = payroll.items
    .map((item) => {
      const days = leave.get(item.employeeId);
      return {
        id: item.id,
        employee: { ...item.employee, name: name(item.employee) },
        basicSalary: item.basicSalary.toString(),
        allowances: item.allowances.toString(),
        gross: filsToString(fils(item.basicSalary) + fils(item.allowances)),
        deductions: item.deductions.toString(),
        netPay: item.netPay.toString(),
        unpaidLeaveDays: days?.UNPAID ?? 0,
        paidLeaveDays: days ? days.ANNUAL + days.SICK + days.OTHER : 0,
        absentDays: absent.get(item.employeeId) ?? 0,
      };
    })
    .sort((a, b) => a.employee.name.localeCompare(b.employee.name));

  return {
    id: payroll.id,
    month: payroll.periodStart.toISOString().slice(0, 7),
    label: monthLabel(payroll.periodStart),
    periodStart: payroll.periodStart,
    periodEnd: payroll.periodEnd,
    days: leaveDays(payroll.periodStart, payroll.periodEnd),
    status: payroll.status,
    calculatedAt: payroll.calculatedAt,
    createdBy: payroll.createdBy.fullName,
    approvedBy: payroll.approvedBy?.fullName ?? null,
    approvedAt: payroll.approvedAt,
    paidBy: payroll.paidBy?.fullName ?? null,
    paidAt: payroll.paidAt,
    lines,
    totals: totalsOf(payroll.items),
  };
}

export type PayrollRun = Awaited<ReturnType<typeof getPayrollRun>>;
