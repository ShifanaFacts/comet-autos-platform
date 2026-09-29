'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/authorize';
import { runAction, toClientResult } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { formDataToObject } from '@/lib/form-data';
import { fileVatReturn, settleVatReturn } from '@/lib/accounting/vat-filing';

function refresh() {
  revalidatePath('/finance', 'layout');
}

export async function fileVatReturnAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => fileVatReturn(user, formDataToObject(formData)));
  if (result.ok) refresh();
  return toClientResult(result);
}

export async function settleVatReturnAction(
  filingId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => settleVatReturn(user, filingId, formDataToObject(formData)));
  if (result.ok) refresh();
  return toClientResult(result);
}
