'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/authorize';
import { runAction, toClientResult } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { formDataToObject } from '@/lib/form-data';
import { editTask, moveTask, setTaskHighlight, setTaskStatus } from '@/lib/team/tasks';
import type { TaskStatus } from '@/generated/prisma/enums';

/*
 * Server actions for tasks. Each re-reads the session and hands to the
 * service — who may do what lives in lib/team/task-rules, enforced there.
 * Creating a task and adding a note go through route handlers (they carry
 * photos and voice notes): /team/tasks and /team/tasks/[id]/notes.
 */

function refresh(taskId: string) {
  revalidatePath('/my-work');
  revalidatePath('/team');
  revalidatePath(`/team/tasks/${taskId}`);
}

/** The round checkbox, the "Start" button and "Reopen". */
export async function setTaskStatusAction(
  taskId: string,
  status: TaskStatus,
  comment?: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => setTaskStatus(user, taskId, { status, comment }));
  if (result.ok) refresh(taskId);
  return toClientResult(result);
}

export async function moveTaskAction(
  taskId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => moveTask(user, taskId, formDataToObject(formData)));
  if (result.ok) refresh(taskId);
  return toClientResult(result);
}

export async function setTaskHighlightAction(
  taskId: string,
  highlighted: boolean,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => setTaskHighlight(user, taskId, highlighted));
  if (result.ok) refresh(taskId);
  return toClientResult(result);
}

export async function editTaskAction(
  taskId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => editTask(user, taskId, formDataToObject(formData)));
  if (result.ok) refresh(taskId);
  return toClientResult(result);
}
