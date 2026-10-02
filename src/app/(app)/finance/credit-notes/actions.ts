'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/authorize';
import { runAction, toClientResult } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { formDataToObject } from '@/lib/form-data';
import { prisma } from '@/lib/prisma';
import {
  createCreditNote,
  recordCreditNoteRefund,
  voidCreditNote,
} from '@/lib/billing/credit-notes';

/** Everywhere a credit note changes a figure: its invoice, the lists, VAT and the books. */
async function refresh(invoiceId: string, creditNoteId?: string) {
  revalidatePath('/finance/credit-notes');
  if (creditNoteId) revalidatePath(`/finance/credit-notes/${creditNoteId}`);
  revalidatePath('/finance/invoices');
  revalidatePath(`/finance/invoices/${invoiceId}`);
  revalidatePath('/finance');
  revalidatePath('/finance/outstanding');
  revalidatePath('/finance/vat');
  revalidatePath('/finance/accounting');
  revalidatePath('/');
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { jobCardId: true },
  });
  if (invoice?.jobCardId) revalidatePath(`/job-cards/${invoice.jobCardId}`, 'layout');
}

/** Issues a credit note; the lines arrive as a plain object from the form. */
export async function createCreditNoteAction(
  invoiceId: string,
  input: {
    issueDate: string;
    reason: string;
    lines: { invoiceItemId: string; amount: string; quantity?: string }[];
    requestKey: string;
  },
): Promise<
  ActionResult<{ creditNoteId: string; refundAmount: string; returnedToAdvances: string }>
> {
  const user = await requireUser();
  const result = await runAction(() => createCreditNote(user, invoiceId, input));
  if (result.ok) await refresh(invoiceId, result.data!.creditNoteId);
  // A double-submitted form already issued it: open that one.
  const issued = result.data ?? (result.duplicateOf ? { creditNoteId: result.duplicateOf, refundAmount: '0.00', returnedToAdvances: '0.00' } : null);
  return {
    ...toClientResult(result),
    data: issued
      ? {
          creditNoteId: issued.creditNoteId,
          refundAmount: issued.refundAmount,
          returnedToAdvances: issued.returnedToAdvances,
        }
      : undefined,
  };
}

export async function recordCreditNoteRefundAction(
  creditNoteId: string,
  invoiceId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() =>
    recordCreditNoteRefund(user, creditNoteId, formDataToObject(formData)),
  );
  if (result.ok || result.duplicate) await refresh(invoiceId, creditNoteId);
  return toClientResult(result);
}

export async function voidCreditNoteAction(
  creditNoteId: string,
  input: { reason: string; requestKey: string },
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => voidCreditNote(user, creditNoteId, input));
  if (result.ok) await refresh(result.data!.invoiceId, creditNoteId);
  return toClientResult(result);
}
