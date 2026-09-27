'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/authorize';
import { runAction, toClientResult } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { formDataToObject } from '@/lib/form-data';
import { cancelLeave, decideLeave, requestLeave } from '@/lib/hr/leave';

function refresh() {
  revalidatePath('/hr', 'layout');
}

export async function requestLeaveAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => requestLeave(user, formDataToObject(formData)));
  if (result.ok || result.duplicate) refresh();
  return toClientResult(result);
}

export async function decideLeaveAction(
  leaveId: string,
  decision: 'APPROVED' | 'REJECTED',
  input: { reason: string; requestKey: string },
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => decideLeave(user, leaveId, decision, input));
  if (result.ok) refresh();
  return toClientResult(result);
}

export async function cancelLeaveAction(
  leaveId: string,
  input: { reason: string; requestKey: string },
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => cancelLeave(user, leaveId, input));
  if (result.ok) refresh();
  return toClientResult(result);
}
