'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/authorize';
import { runAction, toClientResult } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { formDataToObject } from '@/lib/form-data';
import {
  createFixedAsset,
  deleteFixedAsset,
  disposeFixedAsset,
  runDepreciation,
} from '@/lib/accounting/fixed-assets';

function refresh(assetId?: string) {
  revalidatePath('/finance/fixed-assets');
  if (assetId) revalidatePath(`/finance/fixed-assets/${assetId}`);
  revalidatePath('/finance/accounting');
}

export async function createFixedAssetAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => createFixedAsset(user, formDataToObject(formData)));
  if (!result.ok) return toClientResult(result);
  refresh();
  redirect(`/finance/fixed-assets/${result.data!.fixedAssetId}`);
}

export async function runDepreciationAction(
  _prev: ActionResult<{ charged: number; failed: string[] }>,
  formData: FormData,
): Promise<ActionResult<{ charged: number; failed: string[] }>> {
  const user = await requireUser();
  const result = await runAction(() => runDepreciation(user, formDataToObject(formData)));
  if (result.ok) refresh();
  return result;
}

export async function disposeFixedAssetAction(
  assetId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() =>
    disposeFixedAsset(user, assetId, formDataToObject(formData)),
  );
  if (result.ok) refresh(assetId);
  return toClientResult(result);
}

export async function deleteFixedAssetAction(assetId: string): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => deleteFixedAsset(user, assetId));
  if (!result.ok) return toClientResult(result);
  refresh();
  redirect('/finance/fixed-assets');
}
