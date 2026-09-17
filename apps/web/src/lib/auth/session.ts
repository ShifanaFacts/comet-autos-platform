import { randomBytes, createHash } from 'node:crypto';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';

export const SESSION_COOKIE_NAME = 'comet_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

// Session tokens are high-entropy random values, not user-chosen secrets —
// a fast SHA-256 lookup hash is appropriate here (unlike passwords, which
// use bcrypt because they're low-entropy and must resist offline guessing).
function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export interface AuthenticatedUser {
  id: string;
  organizationId: string;
  primaryBranchId: string | null;
  email: string;
  fullName: string;
  /** Permission codes effective org-wide (branchId null on the grant). */
  orgWidePermissions: Set<string>;
  /** Permission codes effective only for specific branches. */
  branchPermissions: Map<string, Set<string>>;
}

export async function createSession(userId: string, organizationId: string): Promise<string> {
  const rawToken = randomBytes(32).toString('hex');

  await prisma.session.create({
    data: {
      organizationId,
      userId,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });

  return rawToken;
}

export async function revokeSession(rawToken: string): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(rawToken), revokedAt: null },
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
    where: { tokenHash: hashToken(rawToken) },
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
    orgWidePermissions,
    branchPermissions,
  };
});
