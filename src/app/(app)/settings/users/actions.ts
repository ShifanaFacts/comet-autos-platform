'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/authorize';
import { runAction, toClientResult } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { formDataToObject } from '@/lib/form-data';
import { createUser, resetUserPassword, setUserActive, updateUser } from '@/lib/access/users';
import { createRole, updateRole, updateRolePermissions } from '@/lib/access/roles';

/*
 * Server actions for access management. Each one re-reads the session and
 * hands straight to the service — the permission check, the organization
 * scope and every business rule live there, so calling one of these
 * directly gains nothing the screen would not have allowed either.
 */

function refreshAccess() {
  revalidatePath('/settings/users', 'layout');
  revalidatePath('/settings/roles', 'layout');
}

/** A role change alters what the sidebar shows anyone holding it. */
function refreshEverywhere() {
  revalidatePath('/', 'layout');
}

/** Checkbox groups arrive as repeated fields, not a single value. */
function withList(formData: FormData, name: string) {
  return { ...formDataToObject(formData), [name]: formData.getAll(name).map(String) };
}

export async function createUserAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => createUser(user, withList(formData, 'roleIds')));
  const id = result.data?.id ?? (result.duplicate ? result.duplicateOf : null);
  if (!result.ok || !id) return toClientResult(result);
  refreshAccess();
  redirect(`/settings/users/${id}?created=1`);
}

export async function updateUserAction(
  userId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => updateUser(user, userId, withList(formData, 'roleIds')));
  if (!result.ok) return toClientResult(result);
  refreshAccess();
  refreshEverywhere();
  redirect(`/settings/users/${userId}`);
}

export async function setUserActiveAction(
  userId: string,
  isActive: boolean,
  reason?: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() =>
    setUserActive(user, userId, { isActive: String(isActive), reason }),
  );
  if (result.ok) refreshAccess();
  return toClientResult(result);
}

export async function resetPasswordAction(
  userId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => resetUserPassword(user, userId, formDataToObject(formData)));
  if (result.ok) refreshAccess();
  return toClientResult(result);
}

export async function createRoleAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => createRole(user, formDataToObject(formData)));
  const id = result.data?.id ?? (result.duplicate ? result.duplicateOf : null);
  if (!result.ok || !id) return toClientResult(result);
  refreshAccess();
  redirect(`/settings/roles/${id}`);
}

export async function updateRoleAction(
  roleId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => updateRole(user, roleId, formDataToObject(formData)));
  if (result.ok) refreshAccess();
  return toClientResult(result);
}

export async function updateRolePermissionsAction(
  roleId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() =>
    updateRolePermissions(user, roleId, {
      permissions: formData.getAll('permissions').map(String),
    }),
  );
  if (!result.ok) return toClientResult(result);
  refreshAccess();
  refreshEverywhere();
  return toClientResult(result);
}
