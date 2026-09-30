'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/authorize';
import { runAction, toClientResult } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { formDataToObject } from '@/lib/form-data';
import { recordExpense, updateExpense, voidExpense } from '@/lib/finance/expenses';
import { removeExpenseBill } from '@/lib/finance/expense-bills';

function refreshFinance() {
  revalidatePath('/finance', 'layout');
}

export async function recordExpenseAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => recordExpense(user, formDataToObject(formData)));
  if (result.ok || result.duplicate) refreshFinance();
  return toClientResult(result);
}

/**
 * Records an expense filled by Scan bill. Answers with the new expense's id
 * so the browser can attach the scanned file to it.
 */
export async function recordScannedExpenseAction(
  _prev: ActionResult<{ id: string }>,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const result = await runAction(() => recordExpense(user, formDataToObject(formData)));
  if (result.ok || result.duplicate) refreshFinance();
  const id = result.data?.id ?? (result.duplicate ? result.duplicateOf : null);
  return { ...toClientResult(result), data: id ? { id } : undefined };
}

export async function voidExpenseAction(
  expenseId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => voidExpense(user, expenseId, formDataToObject(formData)));
  if (result.ok) refreshFinance();
  return toClientResult(result);
}

export async function updateExpenseAction(
  expenseId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => updateExpense(user, expenseId, formDataToObject(formData)));
  if (result.ok) refreshFinance();
  return toClientResult(result);
}

export async function removeExpenseBillAction(documentId: string): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => removeExpenseBill(user, documentId));
  if (result.ok) refreshFinance();
  return toClientResult(result);
}
