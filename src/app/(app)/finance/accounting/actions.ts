'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/authorize';
import { runAction, toClientResult } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { formDataToObject } from '@/lib/form-data';
import { createAccount, updateAccount } from '@/lib/finance/accounting';
import {
  bookExistingRecords,
  completeStandardChart,
  createManualEntry,
  reverseManualEntry,
} from '@/lib/accounting/entries';
import { closeBooks, reopenAllBooks } from '@/lib/accounting/periods';
import { localDateString } from '@/lib/format';
import {
  addCustomerOpeningBalance,
  removeCustomerOpeningBalance,
  saveOpeningBalances,
} from '@/lib/accounting/opening-balances';
import { closeFinancialYear, reopenFinancialYear } from '@/lib/accounting/year-end';

function refresh() {
  revalidatePath('/finance', 'layout');
}

export async function createAccountAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => createAccount(user, formDataToObject(formData)));
  if (result.ok) refresh();
  return toClientResult(result);
}

export async function updateAccountAction(
  accountId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => updateAccount(user, accountId, formDataToObject(formData)));
  if (result.ok) refresh();
  return toClientResult(result);
}

/** Books everything recorded before the books existed. */
export async function bookExistingRecordsAction(): Promise<
  ActionResult<{ booked: number; failed: string[] }>
> {
  const user = await requireUser();
  const result = await runAction(() => bookExistingRecords(user));
  if (result.ok) refresh();
  return { ...toClientResult(result), data: result.data };
}

/** A journal entry made by hand. Its lines arrive as one JSON field. */
export async function createManualEntryAction(
  _prev: ActionResult<{ entryNumber: string | null }>,
  formData: FormData,
): Promise<ActionResult<{ entryNumber: string | null }>> {
  const user = await requireUser();
  const input = formDataToObject(formData);
  let lines: unknown = [];
  try {
    lines = input.lines ? JSON.parse(input.lines) : [];
  } catch {
    return { ok: false, error: 'The entry’s lines could not be read. Refresh and try again.' };
  }
  const result = await runAction(async () => {
    const entry = await createManualEntry(user, { ...input, lines });
    return { entryNumber: entry.entryNumber };
  });
  if (result.ok) refresh();
  return { ...toClientResult(result), data: result.data };
}

export async function reverseManualEntryAction(
  entryId: string,
  input: { reason: string },
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() =>
    reverseManualEntry(user, entryId, { reason: input.reason, date: localDateString() }),
  );
  if (result.ok) refresh();
  return toClientResult(result);
}

export async function addStandardAccountsAction(): Promise<ActionResult<{ added: number }>> {
  const user = await requireUser();
  const result = await runAction(() => completeStandardChart(user));
  if (result.ok) refresh();
  return { ...toClientResult(result), data: result.data };
}

export async function closeBooksAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => closeBooks(user, formDataToObject(formData)));
  if (result.ok) refresh();
  return toClientResult(result);
}

export async function reopenBooksAction(input: { reason: string }): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => reopenAllBooks(user, input));
  if (result.ok) refresh();
  return toClientResult(result);
}

/** The general accounts' opening balances. The rows arrive as one JSON field. */
export async function saveOpeningBalancesAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const input = formDataToObject(formData);
  let lines: unknown = [];
  try {
    lines = input.lines ? JSON.parse(input.lines) : [];
  } catch {
    return { ok: false, error: 'The balances could not be read. Refresh and try again.' };
  }
  const result = await runAction(() => saveOpeningBalances(user, { ...input, lines }));
  if (result.ok || result.duplicate) refresh();
  return toClientResult(result);
}

export async function addCustomerOpeningBalanceAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => addCustomerOpeningBalance(user, formDataToObject(formData)));
  if (result.ok || result.duplicate) refresh();
  return toClientResult(result);
}

export async function removeCustomerOpeningBalanceAction(
  invoiceId: string,
  input: { reason: string },
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => removeCustomerOpeningBalance(user, invoiceId, input));
  if (result.ok) refresh();
  return toClientResult(result);
}

export async function closeFinancialYearAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => closeFinancialYear(user, formDataToObject(formData)));
  if (result.ok) refresh();
  return toClientResult(result);
}

export async function reopenFinancialYearAction(
  entryId: string,
  input: { reason: string },
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => reopenFinancialYear(user, entryId, input));
  if (result.ok) refresh();
  return toClientResult(result);
}
