import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { DomainError, NotFoundError } from '@/lib/errors';
import { parseInput } from '@/lib/form-data';
import { emptyToNull, normalizePhone } from '@/lib/normalize';

/*
 * The workshop's branches — where it works from. Their names appear in the
 * top bar, on stock and staff screens, and in user access. Editable in
 * Settings alongside the workshop's own details, under the same rights.
 *
 * The branch code is not editable: document numbering and imports key on it.
 */

const branchSchema = z.object({
  name: z
    .string({ error: 'Enter the branch name.' })
    .trim()
    .min(2, 'Enter the branch name.')
    .max(120, 'Keep the name under 120 characters.'),
  address: z.string().trim().max(300).optional(),
  phone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .refine((value) => !value || /^[+\d][\d\s()-]{5,}$/.test(value), 'Enter a valid phone number.'),
});

export async function listBranches(user: AuthenticatedUser) {
  requirePermission(user, 'settings.view');
  return prisma.branch.findMany({
    where: { organizationId: user.organizationId },
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    select: { id: true, code: true, name: true, address: true, phone: true, isActive: true },
  });
}

export type BranchSettings = Awaited<ReturnType<typeof listBranches>>[number];

export async function updateBranch(user: AuthenticatedUser, branchId: string, rawInput: unknown) {
  const input = parseInput(branchSchema, rawInput);
  requirePermission(user, 'settings.edit');
  const data = {
    name: input.name.replace(/\s+/g, ' '),
    address: emptyToNull(input.address),
    phone: input.phone ? normalizePhone(input.phone) : null,
  };

  return prisma.$transaction(async (tx) => {
    const before = await tx.branch.findFirst({
      where: { id: branchId, organizationId: user.organizationId },
      select: { id: true, name: true, address: true, phone: true },
    });
    if (!before) throw new NotFoundError('branch');
    const clash = await tx.branch.findFirst({
      where: {
        organizationId: user.organizationId,
        id: { not: before.id },
        name: { equals: data.name, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (clash) throw new DomainError('Another branch already has this name.', 'name');

    await tx.branch.update({ where: { id: before.id }, data });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: before.id,
      actorUserId: user.id,
      action: 'branch.updated',
      entityType: 'Branch',
      entityId: before.id,
      beforeData: { name: before.name, address: before.address, phone: before.phone },
      afterData: data,
    });
    return { branchId: before.id };
  });
}

// ─── Location lock ──────────────────────────────────────────────────────────

const locationSchema = z.object({
  latitude: z.coerce
    .number({ error: 'Set the workshop’s position.' })
    .min(-90, 'Enter a valid latitude.')
    .max(90, 'Enter a valid latitude.'),
  longitude: z.coerce
    .number({ error: 'Set the workshop’s position.' })
    .min(-180, 'Enter a valid longitude.')
    .max(180, 'Enter a valid longitude.'),
  radius: z.coerce
    .number({ error: 'Enter the radius in metres.' })
    .int('Enter whole metres.')
    .min(30, 'Use at least 30 m — phone GPS is rarely closer than that indoors.')
    .max(2000, 'Use at most 2,000 m.'),
  shiftStartTime: z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter the time as HH:MM, e.g. 08:00.'),
  shiftEndTime: z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter the time as HH:MM, e.g. 20:00.'),
});

/** The branch's location lock, for check-in and the settings form. */
export async function getBranchLocation(organizationId: string, branchId: string) {
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, organizationId },
    select: {
      id: true,
      name: true,
      latitude: true,
      longitude: true,
      geofenceRadiusM: true,
      shiftStartTime: true,
      shiftEndTime: true,
    },
  });
  if (!branch) return null;
  return {
    id: branch.id,
    name: branch.name,
    fence:
      branch.latitude !== null && branch.longitude !== null
        ? {
            latitude: Number(branch.latitude),
            longitude: Number(branch.longitude),
            radiusM: branch.geofenceRadiusM,
          }
        : null,
    radiusM: branch.geofenceRadiusM,
    shiftStartTime: branch.shiftStartTime,
    shiftEndTime: branch.shiftEndTime,
  };
}

export type BranchLocation = NonNullable<Awaited<ReturnType<typeof getBranchLocation>>>;

/**
 * Sets where the workshop is, how close staff must be to check themselves in
 * or out, and when the working day ends (a day left open is closed then).
 */
export async function updateBranchLocation(
  user: AuthenticatedUser,
  branchId: string,
  rawInput: unknown,
) {
  const input = parseInput(locationSchema, rawInput);
  requirePermission(user, 'settings.edit');
  if (input.latitude === 0 && input.longitude === 0) {
    throw new DomainError('Set the workshop’s position.', 'latitude');
  }
  if (input.shiftStartTime >= input.shiftEndTime) {
    throw new DomainError('The working day must start before it ends.', 'shiftStartTime');
  }
  const data = {
    latitude: input.latitude.toFixed(6),
    longitude: input.longitude.toFixed(6),
    geofenceRadiusM: input.radius,
    shiftStartTime: input.shiftStartTime,
    shiftEndTime: input.shiftEndTime,
  };

  return prisma.$transaction(async (tx) => {
    const before = await tx.branch.findFirst({
      where: { id: branchId, organizationId: user.organizationId },
      select: {
        id: true,
        latitude: true,
        longitude: true,
        geofenceRadiusM: true,
        shiftStartTime: true,
        shiftEndTime: true,
      },
    });
    if (!before) throw new NotFoundError('branch');
    await tx.branch.update({ where: { id: before.id }, data });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: before.id,
      actorUserId: user.id,
      action: 'branch.location_set',
      entityType: 'Branch',
      entityId: before.id,
      beforeData: {
        latitude: before.latitude?.toString() ?? null,
        longitude: before.longitude?.toString() ?? null,
        geofenceRadiusM: before.geofenceRadiusM,
        shiftStartTime: before.shiftStartTime,
        shiftEndTime: before.shiftEndTime,
      },
      afterData: data,
    });
    return { branchId: before.id };
  });
}
