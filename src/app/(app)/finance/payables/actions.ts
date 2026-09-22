'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/authorize';
import { runAction, toClientResult } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { formDataToObject } from '@/lib/form-data';
import { recordSupplierPayment, reverseSupplierPayment } from '@/lib/finance/supplier-payments';

/*
 * Server actions for supplier payments. Each re-reads the session and hands
 * straight to the service — the permission, the organization and branch
 * scope, the overpayment check and the request key all live there, so
 * calling one of these directly gains nothing the screen would not allow.
 */

function refreshPayables(supplierId?: string) {
  revalidatePath('/finance/payables');
  revalidatePath('/finance/outstanding');
  revalidatePath('/finance');
  if (supplierId) revalidatePath(`/finance/payables/${supplierId}`);
  // The supplier directory shows the same balance.
  revalidatePath('/inventory/suppliers', 'layout');
}

export async function recordSupplierPaymentAction(
  purchaseId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() =>
    recordSupplierPayment(user, purchaseId, formDataToObject(formData)),
  );
  if (result.ok) refreshPayables(result.data?.supplierId);
  return toClientResult(result);
}

export async function reverseSupplierPaymentAction(
  paymentId: string,
  reason: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() =>
    reverseSupplierPayment(user, paymentId, {
      reason,
      // A reversal is a one-off click, not a form; the id makes a repeat of
      // the same click the same submission.
      requestKey: `reverse-supplier-payment-${paymentId}`,
    }),
  );
  if (result.ok) refreshPayables(result.data?.supplierId);
  return toClientResult(result);
}
