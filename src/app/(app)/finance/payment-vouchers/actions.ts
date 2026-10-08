'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/authorize';
import { runAction, toClientResult } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { formDataToObject } from '@/lib/form-data';
import {
  payCardCollection,
  recordCardCollection,
  recordWorkPayment,
  voidPaymentVoucher,
} from '@/lib/finance/payment-vouchers';

/** A voucher moves money and, for outside work, an expense: every screen that shows them. */
function refresh() {
  revalidatePath('/finance', 'layout');
  revalidatePath('/');
}

/** Answers with the voucher's id, so the browser can open it to print. */
function withId(result: Awaited<ReturnType<typeof runAction<{ id: string }>>>) {
  const id = result.data?.id ?? (result.duplicate ? result.duplicateOf : null);
  return { ...toClientResult(result), data: id ? { id } : undefined };
}

export async function recordCardCollectionAction(
  _prev: ActionResult<{ id: string }>,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const result = await runAction(() => recordCardCollection(user, formDataToObject(formData)));
  if (result.ok || result.duplicate) refresh();
  return withId(result);
}

export async function recordWorkPaymentAction(
  _prev: ActionResult<{ id: string }>,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const result = await runAction(() => recordWorkPayment(user, formDataToObject(formData)));
  if (result.ok || result.duplicate) refresh();
  return withId(result);
}

export async function payCardCollectionAction(
  voucherId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() =>
    payCardCollection(user, voucherId, formDataToObject(formData)),
  );
  if (result.ok || result.duplicate) refresh();
  return toClientResult(result);
}

export async function voidPaymentVoucherAction(
  voucherId: string,
  input: { reason: string; requestKey: string },
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => voidPaymentVoucher(user, voucherId, input));
  if (result.ok) refresh();
  return toClientResult(result);
}
