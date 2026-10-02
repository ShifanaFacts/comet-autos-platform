'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/authorize';
import { runAction, toClientResult } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { formDataToObject } from '@/lib/form-data';
import {
  applyCustomerAdvance,
  cancelCustomerAdvance,
  receiveCustomerAdvance,
  refundCustomerAdvance,
  reverseAdvanceRefund,
  undoAdvanceApplication,
} from '@/lib/billing/advances';

/**
 * An advance changes what the customer is owed and owes: the advances
 * screens, the invoices it settles, their job cards, the customer and the
 * dashboards.
 */
function refresh() {
  revalidatePath('/finance/advances', 'layout');
  revalidatePath('/finance/invoices', 'layout');
  revalidatePath('/finance/outstanding');
  revalidatePath('/finance/money', 'layout');
  revalidatePath('/finance');
  revalidatePath('/job-cards', 'layout');
  revalidatePath('/customers', 'layout');
  revalidatePath('/');
}

export async function receiveAdvanceAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => receiveCustomerAdvance(user, formDataToObject(formData)));
  if (!result.ok) {
    // A double-submitted form already recorded it — open that advance.
    if (result.duplicate && result.duplicateOf) redirect(`/finance/advances/${result.duplicateOf}`);
    return toClientResult(result);
  }
  refresh();
  redirect(`/finance/advances/${result.data!.id}`);
}

export async function applyAdvanceAction(
  advanceId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() =>
    applyCustomerAdvance(user, advanceId, formDataToObject(formData)),
  );
  if (result.ok || result.duplicate) refresh();
  return toClientResult(result);
}

export async function undoApplicationAction(
  allocationId: string,
  input: { reason: string; requestKey: string },
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => undoAdvanceApplication(user, allocationId, input));
  if (result.ok) refresh();
  return toClientResult(result);
}

export async function refundAdvanceAction(
  advanceId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() =>
    refundCustomerAdvance(user, advanceId, formDataToObject(formData)),
  );
  if (result.ok || result.duplicate) refresh();
  return toClientResult(result);
}

export async function reverseRefundAction(
  refundId: string,
  input: { reason: string; requestKey: string },
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => reverseAdvanceRefund(user, refundId, input));
  if (result.ok) refresh();
  return toClientResult(result);
}

export async function cancelAdvanceAction(
  advanceId: string,
  input: { reason: string; requestKey: string },
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => cancelCustomerAdvance(user, advanceId, input));
  if (result.ok) refresh();
  return toClientResult(result);
}
