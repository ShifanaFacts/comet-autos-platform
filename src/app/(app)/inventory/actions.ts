'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/authorize';
import { runAction, toClientResult } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { formDataToObject } from '@/lib/form-data';
import { adjustStock, createPart, reverseMovement, updatePart } from '@/lib/inventory/parts';
import { createSupplier, updateSupplier } from '@/lib/inventory/suppliers';
import {
  cancelPurchase,
  createPurchase,
  receivePurchase,
  updatePurchase,
} from '@/lib/inventory/purchases';

function refreshInventory() {
  revalidatePath('/inventory', 'layout');
}

export async function createPartAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => createPart(user, formDataToObject(formData)));
  const id = result.data?.id ?? (result.duplicate ? result.duplicateOf : null);
  if (!result.ok || !id) return toClientResult(result);
  refreshInventory();
  redirect(`/inventory/parts/${id}?created=1`);
}

export async function updatePartAction(
  partId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => updatePart(user, partId, formDataToObject(formData)));
  if (!result.ok) return toClientResult(result);
  refreshInventory();
  redirect(`/inventory/parts/${partId}`);
}

export async function adjustStockAction(
  partId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => adjustStock(user, partId, formDataToObject(formData)));
  if (result.ok) refreshInventory();
  return toClientResult(result);
}

export async function reverseMovementAction(
  transactionId: string,
  reason: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => reverseMovement(user, transactionId, { reason }));
  if (result.ok) refreshInventory();
  return toClientResult(result);
}

export async function createSupplierAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => createSupplier(user, formDataToObject(formData)));
  const id = result.data?.id ?? (result.duplicate ? result.duplicateOf : null);
  if (!result.ok || !id) return toClientResult(result);
  refreshInventory();
  redirect(`/inventory/suppliers/${id}`);
}

export async function updateSupplierAction(
  supplierId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() =>
    updateSupplier(user, supplierId, formDataToObject(formData)),
  );
  if (!result.ok) return toClientResult(result);
  refreshInventory();
  redirect(`/inventory/suppliers/${supplierId}`);
}

/** Saves a new purchase; the submit button's `intent` decides whether it is received straight away. */
export async function createPurchaseAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const input = formDataToObject(formData);
  const result = await runAction(() =>
    createPurchase(user, input, { receive: input.intent === 'receive' }),
  );
  const id = result.data?.id ?? (result.duplicate ? result.duplicateOf : null);
  if (!result.ok || !id) return toClientResult(result);
  refreshInventory();
  redirect(`/inventory/purchases/${id}`);
}

export async function updatePurchaseAction(
  purchaseId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() =>
    updatePurchase(user, purchaseId, formDataToObject(formData)),
  );
  if (!result.ok) return toClientResult(result);
  refreshInventory();
  redirect(`/inventory/purchases/${purchaseId}`);
}

/** Receives the quantities typed per line (fields named `line:<purchaseItemId>`). */
export async function receivePurchaseAction(
  purchaseId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const quantities: Record<string, string> = {};
  const input = formDataToObject(formData);
  for (const [key, value] of Object.entries(input)) {
    if (key.startsWith('line:')) quantities[key.slice(5)] = value;
  }
  const result = await runAction(() =>
    receivePurchase(user, purchaseId, quantities, { requestKey: input.requestKey }),
  );
  if (result.ok) refreshInventory();
  const client = toClientResult(result);
  // Line errors are keyed by purchase line id; surface them on the matching input.
  if (client.fieldErrors) {
    client.fieldErrors = Object.fromEntries(
      Object.entries(client.fieldErrors).map(([key, message]) => [`line:${key}`, message]),
    );
  }
  return client;
}

export async function cancelPurchaseAction(purchaseId: string): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => cancelPurchase(user, purchaseId));
  if (result.ok) refreshInventory();
  return toClientResult(result);
}
