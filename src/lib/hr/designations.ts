import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { hasPermission, requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { DomainError, NotFoundError } from '@/lib/errors';
import { parseInput } from '@/lib/form-data';
import { emptyToNull } from '@/lib/normalize';
import { claimRequestKey, settleRequestKey } from '@/lib/request-keys';
import { ROLE_PRESETS } from '@/lib/auth/permission-catalog';
import { getRoleDetail, withImpliedView } from '@/lib/access/roles';

/*
 * Designations: the positions in the workshop — Technician, Supervisor,
 * Manager — kept under HR.
 *
 * What a designation may do in the app is a role's permissions, so access
 * stays one model: a designation carries a role (created with it, or the
 * existing role of the same name), its permissions are ticked on the same
 * grid as any role, and an employee's login holds their designation's role.
 * Moving an employee to another designation moves their login to its role.
 *
 * A designation is never deleted — employees and history point at it — it
 * is made inactive and stops being offered.
 */

const designationSchema = z.object({
  name: z
    .string({ error: 'Enter the designation, e.g. Technician.' })
    .trim()
    .min(2, 'Enter the designation, e.g. Technician.')
    .max(60, 'Keep the designation under 60 characters.'),
  description: z.string().trim().max(300).optional(),
  requestKey: z.string().optional(),
});

const newDesignationSchema = designationSchema.extend({
  /** A ROLE_PRESETS key to start the permissions from; empty starts with none. */
  preset: z.string().trim().optional(),
});

const updateDesignationSchema = designationSchema.extend({
  isActive: z.enum(['true', 'false']).optional(),
});

const clean = (name: string) => name.replace(/\s+/g, ' ');

/** The presets offered when a designation is made, for the form. */
export const DESIGNATION_PRESETS = ROLE_PRESETS.filter((preset) => preset.key !== 'owner').map(
  (preset) => ({ key: preset.key, label: preset.label }),
);

// ─── Reading ────────────────────────────────────────────────────────────────

/** Every designation, with its role and how many people hold it. */
export async function listDesignations(user: AuthenticatedUser) {
  requirePermission(user, 'employee.view');
  const rows = await prisma.designation.findMany({
    where: { organizationId: user.organizationId },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      description: true,
      isActive: true,
      role: { select: { id: true, name: true, _count: { select: { rolePermissions: true } } } },
      _count: { select: { employees: { where: { isActive: true } } } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    role: row.role ? { id: row.role.id, name: row.role.name } : null,
    permissionCount: row.role?._count.rolePermissions ?? 0,
    employeeCount: row._count.employees,
  }));
}

export type DesignationRow = Awaited<ReturnType<typeof listDesignations>>[number];

/** One designation: its permissions (as the role grid) and who holds it. */
export async function getDesignationDetail(user: AuthenticatedUser, designationId: string) {
  requirePermission(user, 'employee.view');
  const designation = await prisma.designation.findFirst({
    where: { id: designationId, organizationId: user.organizationId },
    select: {
      id: true,
      name: true,
      description: true,
      isActive: true,
      roleId: true,
      employees: {
        orderBy: [{ isActive: 'desc' }, { firstName: 'asc' }],
        select: {
          id: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
          isActive: true,
          user: { select: { id: true, isActive: true } },
        },
      },
    },
  });
  if (!designation) throw new NotFoundError('designation');
  const role =
    designation.roleId && hasPermission(user, 'role.view')
      ? await getRoleDetail(user, designation.roleId)
      : null;
  return {
    ...designation,
    role,
    employees: designation.employees.map((employee) => ({
      ...employee,
      name: `${employee.firstName} ${employee.lastName}`.trim(),
    })),
  };
}

/** Active designations for the employee form, plus the one already chosen if it's inactive. */
export async function getDesignationOptions(
  organizationId: string,
  keepId?: string | null,
  client: Prisma.TransactionClient = prisma,
) {
  return client.designation.findMany({
    where: {
      organizationId,
      OR: [{ isActive: true }, ...(keepId ? [{ id: keepId }] : [])],
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, roleId: true },
  });
}

// ─── Writing ────────────────────────────────────────────────────────────────

/**
 * Creates a designation with the role that carries its permissions: the
 * existing role of the same name, or a new one started from a preset. The
 * permissions are then ticked on the designation's page.
 */
export async function createDesignation(user: AuthenticatedUser, rawInput: unknown) {
  const input = parseInput(newDesignationSchema, rawInput);
  requirePermission(user, 'employee.edit');
  const name = clean(input.name);
  const presetKey = emptyToNull(input.preset);
  const preset = presetKey ? DESIGNATION_PRESETS.find((option) => option.key === presetKey) : null;
  if (presetKey && !preset) {
    throw new DomainError('Choose a starting point from the list.', 'preset');
  }

  return prisma.$transaction(async (tx) => {
    await claimRequestKey(tx, user, rawInput, 'designation.create');
    const taken = await tx.designation.findFirst({
      where: { organizationId: user.organizationId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (taken) throw new DomainError('There is already a designation with that name.', 'name');

    let role = await tx.role.findFirst({
      where: { organizationId: user.organizationId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    const linkedExisting = role !== null;
    if (!role) {
      requirePermission(user, 'role.create');
      role = await tx.role.create({
        data: {
          organizationId: user.organizationId,
          name,
          description: `Access for the ${name} designation.`,
          isSystem: false,
        },
        select: { id: true, name: true },
      });
      const codes = withImpliedView(
        ROLE_PRESETS.find((option) => option.key === preset?.key)?.codes ?? [],
      );
      if (codes.length > 0) {
        const permissions = await tx.permission.findMany({
          where: { code: { in: codes } },
          select: { id: true },
        });
        await tx.rolePermission.createMany({
          data: permissions.map((permission) => ({
            organizationId: user.organizationId,
            roleId: role!.id,
            permissionId: permission.id,
          })),
        });
      }
      await writeAuditLog(tx, {
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: 'role.created',
        entityType: 'Role',
        entityId: role.id,
        afterData: { name: role.name, preset: preset?.label ?? null, permissions: codes },
        metadata: { forDesignation: name },
      });
    }

    const designation = await tx.designation.create({
      data: {
        organizationId: user.organizationId,
        name,
        description: emptyToNull(input.description),
        roleId: role.id,
      },
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: 'designation.created',
      entityType: 'Designation',
      entityId: designation.id,
      afterData: { name, role: role.name, linkedExistingRole: linkedExisting },
    });
    await settleRequestKey(tx, user, rawInput, designation.id);
    return designation;
  });
}

/**
 * Renames a designation, changes its description or makes it (in)active.
 * A rename carries to its role (unless that is a built-in one) and to the
 * job title of everyone holding the designation.
 */
export async function updateDesignation(
  user: AuthenticatedUser,
  designationId: string,
  rawInput: unknown,
) {
  const input = parseInput(updateDesignationSchema, rawInput);
  requirePermission(user, 'employee.edit');
  const name = clean(input.name);

  return prisma.$transaction(async (tx) => {
    const before = await tx.designation.findFirst({
      where: { id: designationId, organizationId: user.organizationId },
      include: { role: { select: { id: true, name: true, isSystem: true } } },
    });
    if (!before) throw new NotFoundError('designation');

    const renamed = name !== before.name;
    if (renamed) {
      const taken = await tx.designation.findFirst({
        where: {
          organizationId: user.organizationId,
          name: { equals: name, mode: 'insensitive' },
          id: { not: designationId },
        },
        select: { id: true },
      });
      if (taken) throw new DomainError('There is already a designation with that name.', 'name');
      if (before.role && !before.role.isSystem && before.role.name === before.name) {
        const roleTaken = await tx.role.findFirst({
          where: {
            organizationId: user.organizationId,
            name: { equals: name, mode: 'insensitive' },
            id: { not: before.role.id },
          },
          select: { id: true },
        });
        if (!roleTaken) {
          await tx.role.update({ where: { id: before.role.id }, data: { name } });
        }
      }
      await tx.employee.updateMany({
        where: { organizationId: user.organizationId, designationId },
        data: { jobTitle: name },
      });
    }

    const designation = await tx.designation.update({
      where: { id: designationId },
      data: {
        name,
        description: emptyToNull(input.description),
        isActive: input.isActive ? input.isActive === 'true' : before.isActive,
      },
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: 'designation.updated',
      entityType: 'Designation',
      entityId: designationId,
      beforeData: { name: before.name, description: before.description, isActive: before.isActive },
      afterData: {
        name: designation.name,
        description: designation.description,
        isActive: designation.isActive,
      },
    });
    return designation;
  });
}
