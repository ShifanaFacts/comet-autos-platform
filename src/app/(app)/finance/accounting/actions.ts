'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/authorize';
import { runAction, toClientResult } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { formDataToObject } from '@/lib/form-data';
import { createAccount, updateAccount } from '@/lib/finance/accounting';

function refresh() {
  revalidatePath('/finance', 'layout');
}

export async function createAccountAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => createAccount(user, formDataToObject(formData)));
  if (result.ok) refresh();
  return toClientResult(result);
}

export async function updateAccountAction(
  accountId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => updateAccount(user, accountId, formDataToObject(formData)));
  if (result.ok) refresh();
  return toClientResult(result);
}
