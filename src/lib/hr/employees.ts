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
import { hashPassword } from '@/lib/auth/password';

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
  /** Empty: the next automatic code (EMP-005) is given. */
  employeeCode: z
    .string()
    .trim()
    .max(40)
    .refine(
      (value) => !value || /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(value),
      'Use letters, numbers and - . _ / only — it is also their sign-in name.',
    )
    .optional(),
  designationId: z.union([z.literal(''), z.uuid('Choose a designation.')]).optional(),
  /** Used only while no designation is chosen (records from before designations). */
  jobTitle: z.string().trim().max(80).optional(),
  phone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .refine((value) => !value || /^[+\d][\d\s()-]{5,}$/.test(value), 'Enter a valid phone number.'),
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
  /**
   * Their system login: an existing login's id, `new` to create one (signs in
   * with the employee code, first password the code too), or empty for none.
   */
  userId: z.string().trim().optional(),
  isActive: z.enum(['true', 'false']).optional(),
  requestKey: z.string().optional(),
});

type EmployeeInput = z.infer<typeof employeeSchema>;

const name = (employee: { firstName: string; lastName: string }) =>
  `${employee.firstName} ${employee.lastName}`.trim();

/** The login field's value that asks for a new login rather than an existing one. */
export const NEW_LOGIN = 'new';

const AUTO_CODE = /^EMP-(\d{1,9})$/;

/**
 * The next automatic employee code, continuing the workshop's own EMP-001
 * style. An advisory lock held to the end of the transaction keeps two
 * employees saved at once from being handed the same code.
 */
async function nextEmployeeCode(tx: Prisma.TransactionClient, organizationId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`employee-code:${organizationId}`}))`;
  const codes = await tx.employee.findMany({
    where: { organizationId, employeeCode: { startsWith: 'EMP-' } },
    select: { employeeCode: true },
  });
  let last = 0;
  let width = 3;
  for (const { employeeCode } of codes) {
    const match = AUTO_CODE.exec(employeeCode);
    if (!match) continue;
    last = Math.max(last, Number(match[1]));
    width = Math.max(width, match[1].length);
  }
  return `EMP-${String(last + 1).padStart(width, '0')}`;
}

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

/** The chosen designation, which must be this workshop's and still in use (unless already held). */
async function resolveDesignation(
  tx: Prisma.TransactionClient,
  organizationId: string,
  designationId: string | null,
  heldId: string | null = null,
) {
  if (!designationId) return null;
  const designation = await tx.designation.findFirst({
    where: { id: designationId, organizationId },
    select: { id: true, name: true, roleId: true, isActive: true },
  });
  if (!designation || (!designation.isActive && designation.id !== heldId)) {
    throw new DomainError('Choose a designation from the list.', 'designationId');
  }
  return designation;
}

function employeeData(input: EmployeeInput) {
  return {
    firstName: input.firstName.replace(/\s+/g, ' '),
    lastName: input.lastName.replace(/\s+/g, ' '),
    phone: input.phone ? normalizePhone(input.phone) : null,
    email: emptyToNull(input.email)?.toLowerCase() ?? null,
    department: emptyToNull(input.department),
    hireDate: new Date(`${input.hireDate}T00:00:00Z`),
    terminationDate: input.terminationDate ? new Date(`${input.terminationDate}T00:00:00Z`) : null,
    branchId: input.branchId,
  };
}

/** The login field: an existing login's id, a request for a new one, or none. */
function loginChoice(value: string | undefined) {
  const choice = emptyToNull(value);
  if (choice === NEW_LOGIN) return { create: true, userId: null };
  return { create: false, userId: choice };
}

/**
 * Makes the employee's login: signs in with their employee code, and the
 * first password is the code too — which is why the first sign-in must
 * choose a new one. It holds their designation's role, so it can do exactly
 * what the designation allows.
 */
async function createEmployeeLogin(
  tx: Prisma.TransactionClient,
  actor: AuthenticatedUser,
  employee: { id: string; employeeCode: string; firstName: string; lastName: string; branchId: string },
  designation: { name: string; roleId: string | null } | null,
) {
  requirePermission(actor, 'user.create');
  if (!designation) {
    throw new DomainError(
      'Choose a designation first — it decides what their login is allowed to do.',
      'designationId',
    );
  }
  if (!designation.roleId) {
    throw new DomainError(
      `The ${designation.name} designation has no permissions set yet. Set them under HR → Designations first.`,
      'designationId',
    );
  }
  const username = employee.employeeCode.toUpperCase();
  const taken = await tx.user.findFirst({
    where: { organizationId: actor.organizationId, username: { equals: username, mode: 'insensitive' } },
    select: { id: true },
  });
  if (taken) throw new DomainError(`Someone already signs in as ${username}.`, 'employeeCode');

  const login = await tx.user.create({
    data: {
      organizationId: actor.organizationId,
      primaryBranchId: employee.branchId,
      username,
      email: null,
      fullName: name(employee),
      passwordHash: await hashPassword(username),
      mustChangePassword: true,
      isActive: true,
    },
    select: { id: true },
  });
  await tx.userRole.create({
    data: {
      organizationId: actor.organizationId,
      userId: login.id,
      roleId: designation.roleId,
      assignedByUserId: actor.id,
    },
  });
  await tx.employee.update({ where: { id: employee.id }, data: { userId: login.id } });
  await writeAuditLog(tx, {
    organizationId: actor.organizationId,
    branchId: employee.branchId,
    actorUserId: actor.id,
    action: 'user.created',
    entityType: 'User',
    entityId: login.id,
    afterData: { fullName: name(employee), username, designation: designation.name },
    metadata: { employeeId: employee.id, firstPasswordIsEmployeeCode: true },
  });
  return login;
}

/**
 * Moves a login from one designation's role to another's. Only the
 * designation's own grant moves — any other role the person was given by
 * hand stays as it is.
 */
async function moveDesignationRole(
  tx: Prisma.TransactionClient,
  actor: AuthenticatedUser,
  loginId: string,
  fromRoleId: string | null,
  toRoleId: string | null,
) {
  if (fromRoleId === toRoleId) return;
  const held = await tx.userRole.findMany({
    where: { userId: loginId, revokedAt: null, branchId: null },
    select: { roleId: true },
  });
  const revoke = fromRoleId !== null && held.some((grant) => grant.roleId === fromRoleId);
  const grant = toRoleId !== null && !held.some((row) => row.roleId === toRoleId);
  if (!revoke && !grant) return;
  if (loginId === actor.id) {
    throw new DomainError(
      'You can’t change the designation that sets your own access. Ask another administrator to do it.',
      'designationId',
    );
  }
  if (!hasPermission(actor, 'user.edit')) {
    throw new DomainError(
      'Changing this designation changes what their login can do, which needs permission to edit users.',
      'designationId',
    );
  }
  if (revoke) {
    await tx.userRole.updateMany({
      where: { userId: loginId, roleId: fromRoleId, revokedAt: null, branchId: null },
      data: { revokedAt: new Date(), revokedByUserId: actor.id },
    });
  }
  if (toRoleId && !held.some((grant) => grant.roleId === toRoleId)) {
    await tx.userRole.create({
      data: {
        organizationId: actor.organizationId,
        userId: loginId,
        roleId: toRoleId,
        assignedByUserId: actor.id,
      },
    });
  }
}

export async function createEmployee(user: AuthenticatedUser, rawInput: unknown) {
  const input = parseInput(employeeSchema, rawInput);
  requirePermission(user, 'employee.create');
  const data = employeeData(input);
  if (data.terminationDate && data.terminationDate < data.hireDate) {
    throw new DomainError('The leaving date is before the joining date.', 'terminationDate');
  }
  await assertBranch(user.organizationId, data.branchId);
  const login = loginChoice(input.userId);

  return prisma.$transaction(async (tx) => {
    await claimRequestKey(tx, user, rawInput, 'employee.create');
    const employeeCode =
      input.employeeCode?.toUpperCase() || (await nextEmployeeCode(tx, user.organizationId));
    await assertCodeFree(user.organizationId, employeeCode, undefined, tx);
    await assertUserFree(user.organizationId, login.userId, undefined, tx);
    const designation = await resolveDesignation(
      tx,
      user.organizationId,
      emptyToNull(input.designationId),
    );
    const employee = await tx.employee.create({
      data: {
        organizationId: user.organizationId,
        ...data,
        employeeCode,
        designationId: designation?.id ?? null,
        jobTitle: designation?.name ?? emptyToNull(input.jobTitle),
        userId: login.userId,
        isActive: input.isActive ? input.isActive === 'true' : true,
      },
    });
    if (login.userId && designation?.roleId) {
      await moveDesignationRole(tx, user, login.userId, null, designation.roleId);
    }
    const created = login.create
      ? await createEmployeeLogin(tx, user, employee, designation)
      : null;
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: employee.branchId,
      actorUserId: user.id,
      action: 'employee.created',
      entityType: 'Employee',
      entityId: employee.id,
      afterData: {
        ...data,
        employeeCode,
        designation: designation?.name ?? null,
        userId: created?.id ?? login.userId,
        hireDate: input.hireDate,
        terminationDate: input.terminationDate,
      },
    });
    await settleRequestKey(tx, user, rawInput, employee.id);
    return { ...employee, userId: created?.id ?? employee.userId };
  });
}

export async function updateEmployee(
  user: AuthenticatedUser,
  employeeId: string,
  rawInput: unknown,
) {
  const input = parseInput(employeeSchema, rawInput);
  requirePermission(user, 'employee.edit');
  const before = await prisma.employee.findFirst({
    where: { id: employeeId, organizationId: user.organizationId },
    include: {
      designation: { select: { roleId: true } },
      user: { select: { id: true, username: true } },
    },
  });
  if (!before) throw new NotFoundError('employee');
  const data = employeeData(input);
  if (data.terminationDate && data.terminationDate < data.hireDate) {
    throw new DomainError('The leaving date is before the joining date.', 'terminationDate');
  }
  // Left empty, the code stays as it is; it is never renumbered.
  const employeeCode = input.employeeCode?.toUpperCase() || before.employeeCode;
  const login = loginChoice(input.userId);
  await assertBranch(user.organizationId, data.branchId);
  await assertCodeFree(user.organizationId, employeeCode, employeeId);
  await assertUserFree(user.organizationId, login.userId, employeeId);

  return prisma.$transaction(async (tx) => {
    const designation = await resolveDesignation(
      tx,
      user.organizationId,
      emptyToNull(input.designationId),
      before.designationId,
    );
    // A designation names the job; without one, a job title typed before
    // designations existed is kept.
    const jobTitle =
      designation?.name ??
      emptyToNull(input.jobTitle) ??
      (before.designationId ? null : before.jobTitle);
    const keptLoginId = login.create ? null : login.userId;

    const employee = await tx.employee.update({
      where: { id: employeeId },
      data: {
        ...data,
        employeeCode,
        designationId: designation?.id ?? null,
        jobTitle,
        userId: keptLoginId,
        isActive: input.isActive ? input.isActive === 'true' : before.isActive,
      },
    });

    if (keptLoginId) {
      // The same login keeps following the designation; a login newly linked
      // is given the designation's role.
      const fromRoleId = keptLoginId === before.userId ? (before.designation?.roleId ?? null) : null;
      await moveDesignationRole(tx, user, keptLoginId, fromRoleId, designation?.roleId ?? null);
      // A login that signs in with the employee code follows a new code.
      if (
        keptLoginId === before.userId &&
        before.user?.username &&
        before.user.username === before.employeeCode.toUpperCase() &&
        employeeCode !== before.employeeCode
      ) {
        const taken = await tx.user.findFirst({
          where: {
            organizationId: user.organizationId,
            username: { equals: employeeCode, mode: 'insensitive' },
            id: { not: keptLoginId },
          },
          select: { id: true },
        });
        if (taken) throw new DomainError(`Someone already signs in as ${employeeCode}.`, 'employeeCode');
        await tx.user.update({ where: { id: keptLoginId }, data: { username: employeeCode } });
      }
    }
    const created = login.create
      ? await createEmployeeLogin(tx, user, employee, designation)
      : null;

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
        designationId: before.designationId,
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
        designationId: employee.designationId,
        phone: employee.phone,
        email: employee.email,
        department: employee.department,
        branchId: employee.branchId,
        userId: created?.id ?? employee.userId,
        isActive: employee.isActive,
      },
    });
    return { ...employee, userId: created?.id ?? employee.userId };
  });
}

/**
 * For an employee who can't sign in: their login's password goes back to
 * their employee code, to be changed at the next sign-in, and every device
 * they were signed in on is signed out. The password is never logged.
 */
export async function resetEmployeeLogin(user: AuthenticatedUser, employeeId: string) {
  requirePermission(user, 'user.edit');
  return prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findFirst({
      where: { id: employeeId, organizationId: user.organizationId },
      select: { id: true, employeeCode: true, branchId: true, userId: true },
    });
    if (!employee) throw new NotFoundError('employee');
    if (!employee.userId) throw new DomainError('This employee has no login to reset.');
    const username = employee.employeeCode.toUpperCase();
    const taken = await tx.user.findFirst({
      where: {
        organizationId: user.organizationId,
        username: { equals: username, mode: 'insensitive' },
        id: { not: employee.userId },
      },
      select: { id: true },
    });
    if (taken) throw new DomainError(`Someone else already signs in as ${username}.`);
    await tx.user.update({
      where: { id: employee.userId },
      data: { username, passwordHash: await hashPassword(username), mustChangePassword: true },
    });
    const { count } = await tx.session.updateMany({
      where: { userId: employee.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: employee.branchId,
      actorUserId: user.id,
      action: 'user.password_reset',
      entityType: 'User',
      entityId: employee.userId,
      metadata: { employeeId, toEmployeeCode: true, sessionsRevoked: count },
    });
    return { username };
  });
}

/** The team, with how much of the workshop's work each person is carrying. */
export async function listEmployees(
  user: AuthenticatedUser,
  options: { query?: string; show?: 'all' | 'active' | 'inactive' } = {},
) {
  requirePermission(user, 'employee.view');
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
  requirePermission(user, 'employee.view');
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
  requirePermission(user, 'employee.edit');
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, organizationId: user.organizationId },
  });
  if (!employee) throw new NotFoundError('employee');
  return employee;
}

/** Branches and the logins that aren't already somebody's, for the employee form. */
export async function getEmployeeFormOptions(user: AuthenticatedUser, employeeId?: string) {
  requirePermission(user, 'employee.edit');
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
