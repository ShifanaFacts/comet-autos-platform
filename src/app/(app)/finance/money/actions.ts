'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/authorize';
import { runAction, toClientResult } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { formDataToObject } from '@/lib/form-data';
import { recordMoneyTransfer, voidMoneyTransfer } from '@/lib/finance/money';

/** A transfer changes two balances: every screen that shows them. */
function refresh() {
  revalidatePath('/finance/money', 'layout');
  revalidatePath('/finance/accounting');
  revalidatePath('/finance');
  revalidatePath('/');
}

export async function recordMoneyTransferAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => recordMoneyTransfer(user, formDataToObject(formData)));
  if (result.ok || result.duplicate) refresh();
  return toClientResult(result);
}

export async function voidMoneyTransferAction(
  transferId: string,
  input: { reason: string; requestKey: string },
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => voidMoneyTransfer(user, transferId, input));
  if (result.ok) refresh();
  return toClientResult(result);
}
