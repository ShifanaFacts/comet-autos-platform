import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { DomainError, NotFoundError } from '@/lib/errors';
import { claimRequestKey, settleRequestKey } from '@/lib/request-keys';
import { parseInput } from '@/lib/form-data';
import { emptyToNull, normalizePhone } from '@/lib/normalize';

/*
 * The workshop's people. An Employee is who did the work — the record the
 * job card, inspection, labour and quality check all point at. A system
 * login (User) is separate and optional: a floor technician is recorded
 * against their work without ever signing in.
 *
 * An employee is never deleted. Someone who leaves is marked inactive with
 * a termination date, so every job they worked on still reads correctly.
 *
 * Contact details belong to the employee, not to any login: a technician who
 * never signs in can still be reached.
 */

const employeeSchema = z.object({
  firstName: z
    .string({ error: 'Enter the first name.' })
    .trim()
    .min(1, 'Enter the first name.')
    .max(80),
  lastName: z
    .string({ error: 'Enter the last name.' })
    .trim()
    .min(1, 'Enter the last name.')
    .max(80),
  employeeCode: z
    .string({ error: 'Enter an employee code.' })
    .trim()
    .min(1, 'Enter an employee code.')
    .max(40),
  jobTitle: z.string().trim().max(80).optional(),
  phone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .refine((value) => !value || /^[+d][ds()-]{5,}$/.test(value), 'Enter a valid phone number.'),
  email: z.union([z.literal(''), z.email('Enter a valid email address.')]).optional(),
  department: z.string().trim().max(80).optional(),
  hireDate: z
    .string({ error: 'Choose the joining date.' })
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the joining date.'),
  terminationDate: z
    .union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.')])
    .optional(),
  branchId: z.string({ error: 'Choose a branch.' }).trim().min(1, 'Choose a branch.'),
  /** Optional system login to attribute this person to. */
  userId: z.string().trim().optional(),
  isActive: z.enum(['true', 'false']).optional(),
  requestKey: z.string().optional(),
});

type EmployeeInput = z.infer<typeof employeeSchema>;

const name = (employee: { firstName: string; lastName: string }) =>
  `${employee.firstName} ${employee.lastName}`.trim();

async function assertCodeFree(
  organizationId: string,
  code: string,
  exceptId: string | undefined,
  client: Prisma.TransactionClient = prisma,
) {
  const clash = await client.employee.findFirst({
    where: {
      organizationId,
      employeeCode: { equals: code, mode: 'insensitive' },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new DomainError('Another employee already has this code.', 'employeeCode');
}

/** A login may stand for only one employee, or attribution becomes ambiguous. */
async function assertUserFree(
  organizationId: string,
  userId: string | null,
  exceptId: string | undefined,
  client: Prisma.TransactionClient = prisma,
) {
  if (!userId) return;
  const user = await client.user.findFirst({
    where: { id: userId, organizationId },
    select: { id: true },
  });
  if (!user) throw new DomainError('Choose a login from this workshop.', 'userId');
  const clash = await client.employee.findFirst({
    where: { organizationId, userId, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { firstName: true, lastName: true },
  });
  if (clash) throw new DomainError(`That login is already ${name(clash)}'s.`, 'userId');
}

async function assertBranch(organizationId: string, branchId: string) {
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, organizationId },
    select: { id: true },
  });
  if (!branch) throw new DomainError('Choose a branch of this workshop.', 'branchId');
}

function employeeData(input: EmployeeInput) {
  return {
    firstName: input.firstName.replace(/\s+/g, ' '),
    lastName: input.lastName.replace(/\s+/g, ' '),
    employeeCode: input.employeeCode.toUpperCase(),
    jobTitle: emptyToNull(input.jobTitle),
    phone: input.phone ? normalizePhone(input.phone) : null,
    email: emptyToNull(input.email)?.toLowerCase() ?? null,
    department: emptyToNull(input.department),
    hireDate: new Date(`${input.hireDate}T00:00:00Z`),
    terminationDate: input.terminationDate ? new Date(`${input.terminationDate}T00:00:00Z`) : null,
    branchId: input.branchId,
    userId: emptyToNull(input.userId),
  };
}

export async function createEmployee(user: AuthenticatedUser, rawInput: unknown) {
  const input = parseInput(employeeSchema, rawInput);
  requirePermission(user, 'payroll.create');
  const data = employeeData(input);
  if (data.terminationDate && data.terminationDate < data.hireDate) {
    throw new DomainError('The leaving date is before the joining date.', 'terminationDate');
  }
  await assertBranch(user.organizationId, data.branchId);

  return prisma.$transaction(async (tx) => {
    await claimRequestKey(tx, user, rawInput, 'employee.create');
    await assertCodeFree(user.organizationId, data.employeeCode, undefined, tx);
    await assertUserFree(user.organizationId, data.userId, undefined, tx);
    const employee = await tx.employee.create({
      data: {
        organizationId: user.organizationId,
        ...data,
        isActive: input.isActive ? input.isActive === 'true' : true,
      },
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: employee.branchId,
      actorUserId: user.id,
      action: 'employee.created',
      entityType: 'Employee',
      entityId: employee.id,
      afterData: { ...data, hireDate: input.hireDate, terminationDate: input.terminationDate },
    });
    await settleRequestKey(tx, user, rawInput, employee.id);
    return employee;
  });
}

export async function updateEmployee(
  user: AuthenticatedUser,
  employeeId: string,
  rawInput: unknown,
) {
  const input = parseInput(employeeSchema, rawInput);
  requirePermission(user, 'payroll.create');
  const before = await prisma.employee.findFirst({
    where: { id: employeeId, organizationId: user.organizationId },
  });
  if (!before) throw new NotFoundError('employee');
  const data = employeeData(input);
  if (data.terminationDate && data.terminationDate < data.hireDate) {
    throw new DomainError('The leaving date is before the joining date.', 'terminationDate');
  }
  await assertBranch(user.organizationId, data.branchId);
  await assertCodeFree(user.organizationId, data.employeeCode, employeeId);
  await assertUserFree(user.organizationId, data.userId, employeeId);

  return prisma.$transaction(async (tx) => {
    const employee = await tx.employee.update({
      where: { id: employeeId },
      data: { ...data, isActive: input.isActive ? input.isActive === 'true' : before.isActive },
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: employee.branchId,
      actorUserId: user.id,
      action: 'employee.updated',
      entityType: 'Employee',
      entityId: employee.id,
      beforeData: {
        firstName: before.firstName,
        lastName: before.lastName,
        employeeCode: before.employeeCode,
        jobTitle: before.jobTitle,
        phone: before.phone,
        email: before.email,
        department: before.department,
        branchId: before.branchId,
        userId: before.userId,
        isActive: before.isActive,
      },
      afterData: {
        firstName: employee.firstName,
        lastName: employee.lastName,
        employeeCode: employee.employeeCode,
        jobTitle: employee.jobTitle,
        phone: employee.phone,
        email: employee.email,
        department: employee.department,
        branchId: employee.branchId,
        userId: employee.userId,
        isActive: employee.isActive,
      },
    });
    return employee;
  });
}

/** The team, with how much of the workshop's work each person is carrying. */
export async function listEmployees(
  user: AuthenticatedUser,
  options: { query?: string; show?: 'all' | 'active' | 'inactive' } = {},
) {
  requirePermission(user, 'payroll.view');
  const q = options.query?.trim() ?? '';
  const show = options.show ?? 'active';
  const employees = await prisma.employee.findMany({
    where: {
      organizationId: user.organizationId,
      ...(show === 'all' ? {} : { isActive: show === 'active' }),
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: 'insensitive' } },
              { lastName: { contains: q, mode: 'insensitive' } },
              { employeeCode: { contains: q, mode: 'insensitive' } },
              { jobTitle: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: [{ isActive: 'desc' }, { firstName: 'asc' }, { lastName: 'asc' }],
    include: {
      branch: { select: { name: true } },
      user: { select: { id: true, email: true, phone: true, fullName: true } },
      _count: { select: { jobAssignments: true, labours: true, qualityChecks: true } },
    },
  });
  return employees.map((employee) => ({ ...employee, name: name(employee) }));
}

export type EmployeeRow = Awaited<ReturnType<typeof listEmployees>>[number];

/** One person: who they are, and the work attributed to them. */
export async function getEmployeeDetail(user: AuthenticatedUser, employeeId: string) {
  requirePermission(user, 'payroll.view');
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, organizationId: user.organizationId },
    include: {
      branch: { select: { name: true } },
      user: { select: { id: true, email: true, phone: true, fullName: true, isActive: true } },
    },
  });
  if (!employee) throw new NotFoundError('employee');

  // Independent reads, fetched together rather than one after another.
  const [openJobs, recentLabour, inspections, qualityChecks] = await Promise.all([
    prisma.jobAssignment.findMany({
      where: {
        organizationId: user.organizationId,
        employeeId,
        unassignedAt: null,
        jobCard: { status: { notIn: ['DELIVERED', 'CANCELLED', 'CLOSED'] } },
      },
      orderBy: { assignedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        assignmentRole: true,
        assignedAt: true,
        jobCard: {
          select: {
            id: true,
            jobNumber: true,
            status: true,
            customer: { select: { name: true } },
            vehicle: { select: { plateNumber: true, make: true, model: true } },
          },
        },
      },
    }),
    prisma.labour.findMany({
      where: { organizationId: user.organizationId, performedByEmployeeId: employeeId },
      orderBy: { performedAt: 'desc' },
      take: 25,
      select: {
        id: true,
        description: true,
        hours: true,
        performedAt: true,
        jobCard: { select: { id: true, jobNumber: true } },
      },
    }),
    prisma.inspection.count({
      where: { organizationId: user.organizationId, inspectedByEmployeeId: employeeId },
    }),
    prisma.qualityCheck.count({
      where: { organizationId: user.organizationId, checkedByEmployeeId: employeeId },
    }),
  ]);

  return {
    employee: { ...employee, name: name(employee) },
    openJobs,
    recentLabour,
    counts: { inspections, qualityChecks },
  };
}

export async function getEmployeeForEdit(user: AuthenticatedUser, employeeId: string) {
  requirePermission(user, 'payroll.create');
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, organizationId: user.organizationId },
  });
  if (!employee) throw new NotFoundError('employee');
  return employee;
}

/** Branches and the logins that aren't already somebody's, for the employee form. */
export async function getEmployeeFormOptions(user: AuthenticatedUser, employeeId?: string) {
  requirePermission(user, 'payroll.create');
  const [branches, users] = await Promise.all([
    prisma.branch.findMany({
      where: { organizationId: user.organizationId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: {
        organizationId: user.organizationId,
        OR: [{ employee: { is: null } }, ...(employeeId ? [{ employee: { id: employeeId } }] : [])],
      },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, email: true },
    }),
  ]);
  return { branches, users };
}
