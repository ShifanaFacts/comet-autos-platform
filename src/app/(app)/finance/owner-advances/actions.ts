'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/authorize';
import { runAction, toClientResult } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { formDataToObject } from '@/lib/form-data';
import { reimburseOwner, reverseOwnerReimbursement } from '@/lib/finance/owner-payments';
import { removeAttachment } from '@/lib/documents/attachments';

/*
 * Server actions for "Owed to owner". Each re-reads the session and hands
 * straight to the service — the permission, the over-repayment check and the
 * request key all live there.
 */

function refreshOwed() {
  revalidatePath('/finance/owner-advances');
  // The dashboards carry the "Owed to owner" line.
  revalidatePath('/finance');
  revalidatePath('/');
}

/**
 * Repays an owner for bills they paid personally. Answers with the new row's
 * id, so the browser can attach the transfer screenshot to it.
 */
export async function reimburseOwnerAction(
  personUserId: string,
  _prev: ActionResult<{ id: string }>,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const result = await runAction(() =>
    reimburseOwner(user, personUserId, formDataToObject(formData)),
  );
  if (result.ok || result.duplicate) refreshOwed();
  const id = result.data?.id ?? (result.duplicate ? result.duplicateOf : null);
  return { ...toClientResult(result), data: id ? { id } : undefined };
}

export async function reverseOwnerReimbursementAction(input: {
  id: string;
  reason: string;
  requestKey: string;
}): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() =>
    reverseOwnerReimbursement(user, input.id, {
      reason: input.reason,
      requestKey: input.requestKey,
    }),
  );
  if (result.ok) refreshOwed();
  return toClientResult(result);
}

export async function removeReimbursementFileAction(documentId: string): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => removeAttachment(user, 'OwnerReimbursement', documentId));
  if (result.ok) refreshOwed();
  return toClientResult(result);
}
