'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { JobCardStatus } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth/authorize';
import { runAction, toClientResult } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { formDataToObject } from '@/lib/form-data';
import { transitionJobStatus } from '@/lib/workshop/job-status';
import { assignPrimaryTechnician } from '@/lib/workshop/assignment';
import { startInspection, saveInspection } from '@/lib/workshop/inspection';
import { saveDiagnosis } from '@/lib/workshop/diagnosis';
import {
  createEstimate,
  saveEstimateDraft,
  sendEstimate,
  reissueEstimateLink,
  reviseEstimate,
  recordCustomerDecision,
} from '@/lib/workshop/estimates';
import { customerQuotePath, getRequestOrigin } from '@/lib/request-origin';

function refreshJob(jobCardId: string) {
  revalidatePath(`/job-cards/${jobCardId}`, 'layout');
  revalidatePath('/job-cards');
  revalidatePath('/');
}

export async function changeJobStatusAction(jobCardId: string, toStatus: JobCardStatus): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(async () => {
    await prisma.$transaction((tx) => transitionJobStatus(tx, user, jobCardId, toStatus));
  });
  if (result.ok) refreshJob(jobCardId);
  return toClientResult(result);
}

export async function assignTechnicianAction(
  jobCardId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() =>
    assignPrimaryTechnician(user, jobCardId, String(formData.get('employeeId') ?? '')),
  );
  if (result.ok) refreshJob(jobCardId);
  return toClientResult(result);
}

export async function startInspectionAction(
  jobCardId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() =>
    startInspection(user, jobCardId, String(formData.get('employeeId') ?? '')),
  );
  if (!result.ok) return toClientResult(result);
  refreshJob(jobCardId);
  redirect(`/job-cards/${jobCardId}/inspection`);
}

export async function saveInspectionAction(
  jobCardId: string,
  inspectionId: string,
  payload: unknown,
  complete: boolean,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => saveInspection(user, inspectionId, payload, { complete }));
  if (result.ok) refreshJob(jobCardId);
  return toClientResult(result);
}

export async function saveDiagnosisAction(
  jobCardId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => saveDiagnosis(user, jobCardId, formDataToObject(formData)));
  if (!result.ok) return toClientResult(result);
  refreshJob(jobCardId);
  redirect(`/job-cards/${jobCardId}/estimate`);
}

export async function createEstimateAction(jobCardId: string): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => createEstimate(user, jobCardId));
  if (result.ok) refreshJob(jobCardId);
  return toClientResult(result);
}

export async function saveEstimateDraftAction(
  jobCardId: string,
  estimateId: string,
  payload: unknown,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => saveEstimateDraft(user, estimateId, payload));
  if (result.ok) refreshJob(jobCardId);
  return toClientResult(result);
}

/** Saves the draft, then sends it. Returns the customer link — the only time the raw link exists. */
export async function saveAndSendEstimateAction(
  jobCardId: string,
  estimateId: string,
  payload: unknown,
): Promise<ActionResult<{ link: string }>> {
  const user = await requireUser();
  const origin = await getRequestOrigin();
  const result = await runAction(async () => {
    await saveEstimateDraft(user, estimateId, payload);
    const { rawToken } = await sendEstimate(user, estimateId);
    return { link: `${origin}${customerQuotePath(rawToken)}` };
  });
  // No revalidation here: re-rendering would unmount the panel that shows the
  // one-time link. The client refreshes when the user closes the panel.
  return result;
}

export async function reissueLinkAction(jobCardId: string, estimateId: string): Promise<ActionResult<{ link: string }>> {
  const user = await requireUser();
  const origin = await getRequestOrigin();
  const result = await runAction(async () => {
    const { rawToken } = await reissueEstimateLink(user, estimateId);
    return { link: `${origin}${customerQuotePath(rawToken)}` };
  });
  return result;
}

export async function reviseEstimateAction(jobCardId: string, estimateId: string): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => reviseEstimate(user, estimateId));
  if (result.ok) refreshJob(jobCardId);
  return toClientResult(result);
}

export async function recordDecisionAction(
  jobCardId: string,
  estimateId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => recordCustomerDecision(user, estimateId, formDataToObject(formData)));
  if (result.ok) refreshJob(jobCardId);
  return toClientResult(result);
}
