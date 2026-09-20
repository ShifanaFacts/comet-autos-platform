import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { DomainError } from '@/lib/errors';
import { parseInput } from '@/lib/form-data';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { hashSessionToken, type AuthenticatedUser } from '@/lib/auth/session';

/*
 * The signed-in user's own account: their profile and their password. Uses
 * the existing session and password machinery; nothing here reveals password
 * hashes or session tokens.
 */

/** What the profile page shows about the signed-in user. */
export async function getAccountProfile(user: AuthenticatedUser) {
  const account = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: {
      fullName: true,
      email: true,
      phone: true,
      isActive: true,
      createdAt: true,
      lastLoginAt: true,
      primaryBranch: { select: { name: true } },
      employee: {
        select: { employeeCode: true, jobTitle: true, department: true, hireDate: true },
      },
      userRoles: {
        where: { revokedAt: null },
        select: { branchId: true, role: { select: { name: true, description: true } } },
      },
      _count: {
        select: { sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } } },
      },
    },
  });
  return {
    fullName: account.fullName,
    email: account.email,
    phone: account.phone,
    isActive: account.isActive,
    joinedAt: account.createdAt,
    lastLoginAt: account.lastLoginAt,
    branch: account.primaryBranch?.name ?? null,
    employee: account.employee,
    roles: account.userRoles.map((grant) => ({
      name: grant.role.name,
      description: grant.role.description,
      allBranches: grant.branchId === null,
    })),
    activeSessions: account._count.sessions,
  };
}

const passwordSchema = z
  .object({
    currentPassword: z
      .string({ error: 'Enter your current password.' })
      .min(1, 'Enter your current password.'),
    newPassword: z
      .string({ error: 'Choose a new password.' })
      .min(8, 'Use at least 8 characters.')
      .max(128, 'Use at most 128 characters.')
      .refine(
        (value) => /[A-Za-z]/.test(value) && /\d/.test(value),
        'Use at least one letter and one number.',
      ),
    confirmPassword: z.string({ error: 'Type the new password again.' }),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The two new passwords are different — type it again.',
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    path: ['newPassword'],
    message: 'Choose a password different from your current one.',
  });

/**
 * Changes the signed-in user's password after checking the current one, and
 * signs out every other session (other devices, other browsers) — the
 * session making the change stays signed in.
 */
export async function changePassword(
  user: AuthenticatedUser,
  rawInput: unknown,
  currentSessionToken: string | null,
) {
  const input = parseInput(passwordSchema, rawInput);
  const account = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  if (!(await verifyPassword(input.currentPassword, account.passwordHash))) {
    throw new DomainError(
      'Your current password is not correct. Check it and try again.',
      'currentPassword',
    );
  }
  const passwordHash = await hashPassword(input.newPassword);
  const keep = currentSessionToken ? hashSessionToken(currentSessionToken) : null;

  return prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    const signedOut = await tx.session.updateMany({
      where: { userId: user.id, revokedAt: null, ...(keep ? { tokenHash: { not: keep } } : {}) },
      data: { revokedAt: new Date() },
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: 'user.password_changed',
      entityType: 'User',
      entityId: user.id,
      metadata: { otherSessionsSignedOut: signedOut.count },
    });
    return { otherSessionsSignedOut: signedOut.count };
  });
}
