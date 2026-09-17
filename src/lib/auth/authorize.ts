import { redirect } from 'next/navigation';
import { getCurrentUser, type AuthenticatedUser } from '@/lib/auth/session';

export class AuthError extends Error {}

/**
 * Loads the current session or redirects to /login. Use at the top of every
 * protected Server Component/Server Action — never trust client state alone.
 */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  return user;
}

/**
 * Enforces the branch-scoping contract from docs/07-security/authorization.md:
 * a grant counts if it's either org-wide, or scoped to the exact branchId
 * being accessed. Throws AuthError on failure — callers in Server Actions
 * should let this propagate (Next.js reports it as a generic error to the
 * client), never leak *why* access was denied to distinguish "forbidden"
 * from "not found".
 */
export function hasPermission(
  user: AuthenticatedUser,
  permissionCode: string,
  options?: { branchId?: string },
): boolean {
  if (user.orgWidePermissions.has(permissionCode)) return true;
  if (options?.branchId) {
    return user.branchPermissions.get(options.branchId)?.has(permissionCode) ?? false;
  }
  return false;
}

export function requirePermission(
  user: AuthenticatedUser,
  permissionCode: string,
  options?: { branchId?: string },
): void {
  if (!hasPermission(user, permissionCode, options)) {
    throw new AuthError(`Missing permission: ${permissionCode}`);
  }
}
