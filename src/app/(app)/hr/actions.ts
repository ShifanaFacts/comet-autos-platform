'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/authorize';
import { runAction, toClientResult } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { formDataToObject } from '@/lib/form-data';
import { createEmployee, updateEmployee } from '@/lib/hr/employees';

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
