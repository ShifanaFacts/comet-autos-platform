'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/authorize';
import { runAction, toClientResult } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { formDataToObject } from '@/lib/form-data';
import { createEmployee, resetEmployeeLogin, updateEmployee } from '@/lib/hr/employees';
import { createDesignation, updateDesignation } from '@/lib/hr/designations';

function refreshTeam() {
  revalidatePath('/hr', 'layout');
}

export async function createEmployeeAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => createEmployee(user, formDataToObject(formData)));
  const id = result.data?.id ?? (result.duplicate ? result.duplicateOf : null);
  if (!result.ok || !id) return toClientResult(result);
  refreshTeam();
  redirect(`/hr/employees/${id}?created=1`);
}

export async function updateEmployeeAction(
  employeeId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() =>
    updateEmployee(user, employeeId, formDataToObject(formData)),
  );
  if (!result.ok) return toClientResult(result);
  refreshTeam();
  redirect(`/hr/employees/${employeeId}`);
}

/** Puts an employee's login back on their employee code, to be changed at the next sign-in. */
export async function resetEmployeeLoginAction(employeeId: string): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => resetEmployeeLogin(user, employeeId));
  if (result.ok) refreshTeam();
  return toClientResult(result);
}

export async function createDesignationAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => createDesignation(user, formDataToObject(formData)));
  const id = result.data?.id ?? (result.duplicate ? result.duplicateOf : null);
  if (!result.ok || !id) return toClientResult(result);
  refreshTeam();
  revalidatePath('/settings', 'layout');
  redirect(`/hr/designations/${id}`);
}

export async function updateDesignationAction(
  designationId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() =>
    updateDesignation(user, designationId, formDataToObject(formData)),
  );
  if (result.ok) {
    refreshTeam();
    revalidatePath('/settings', 'layout');
  }
  return toClientResult(result);
}
