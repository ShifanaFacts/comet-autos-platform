import { randomBytes, createHash } from 'node:crypto';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import {
  isRememberedSession,
  needsRenewal,
  REMEMBER_TTL_MS,
  SESSION_TTL_MS,
} from '@/lib/auth/remember';

export const SESSION_COOKIE_NAME = 'garage_session';

// Session tokens are high-entropy random values, not user-chosen secrets —
// a fast SHA-256 lookup hash is appropriate here (unlike passwords, which
// use bcrypt because they're low-entropy and must resist offline guessing).
export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export interface AuthenticatedUser {
  id: string;
  organizationId: string;
  primaryBranchId: string | null;
  /** Null for an employee's login, which signs in with its employee code. */
  email: string | null;
  fullName: string;
  /** Set until the user chooses their own password; every page sends them to do so. */
  mustChangePassword?: boolean;
  /** Names of the roles granted to the user (e.g. "Owner"), for display only — never for access decisions. */
  roleNames: string[];
  /** Permission codes effective org-wide (branchId null on the grant). */
  orgWidePermissions: Set<string>;
  /** Permission codes effective only for specific branches. */
  branchPermissions: Map<string, Set<string>>;
}

/** A new login. `remember`: it stays signed in until logged out (lib/auth/remember.ts). */
export async function createSession(
  userId: string,
  organizationId: string,
  remember = false,
): Promise<string> {
  const rawToken = randomBytes(32).toString('hex');

  await prisma.session.create({
    data: {
      organizationId,
      userId,
      tokenHash: hashSessionToken(rawToken),
      expiresAt: new Date(Date.now() + (remember ? REMEMBER_TTL_MS : SESSION_TTL_MS)),
    },
  });

  return rawToken;
}

export async function revokeSession(rawToken: string): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashSessionToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Resolves the current request's session cookie into the authenticated user
 * plus their effective permission grants. Returns null for anonymous/expired/
 * revoked sessions — callers must treat null as "not logged in", never throw.
 *
 * Wrapped in React's `cache()`: the app layout, every page, and any nested
 * component all call requireUser()/getCurrentUser() independently (each
 * needs to enforce its own auth, not just trust a parent already did) —
 * without this, that would mean a repeated session+permissions query per
 * request. `cache()` dedupes those into a single DB round trip per request.
 */
export const getCurrentUser = cache(async (): Promise<AuthenticatedUser | null> => {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!rawToken) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(rawToken) },
    include: {
      user: {
        include: {
          userRoles: {
            where: { revokedAt: null },
            include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
          },
        },
      },
    },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    return null;
  }
  if (!session.user.isActive) {
    return null;
  }
  // A remembered login is renewed while it is used (at most once a day), so it
  // never runs out for someone who keeps opening the app.
  if (isRememberedSession(session) && needsRenewal(session.expiresAt)) {
    await prisma.session
      .update({
        where: { id: session.id },
        data: { expiresAt: new Date(Date.now() + REMEMBER_TTL_MS) },
      })
      .catch(() => undefined);
  }

  const orgWidePermissions = new Set<string>();
  const branchPermissions = new Map<string, Set<string>>();

  for (const userRole of session.user.userRoles) {
    const codes = userRole.role.rolePermissions.map((rp) => rp.permission.code);
    if (userRole.branchId === null) {
      for (const code of codes) orgWidePermissions.add(code);
    } else {
      const existing = branchPermissions.get(userRole.branchId) ?? new Set<string>();
      for (const code of codes) existing.add(code);
      branchPermissions.set(userRole.branchId, existing);
    }
  }

  return {
    id: session.user.id,
    organizationId: session.user.organizationId,
    primaryBranchId: session.user.primaryBranchId,
    email: session.user.email,
    fullName: session.user.fullName,
    mustChangePassword: session.user.mustChangePassword,
    roleNames: [...new Set(session.user.userRoles.map((userRole) => userRole.role.name))],
    orgWidePermissions,
    branchPermissions,
  };
});
