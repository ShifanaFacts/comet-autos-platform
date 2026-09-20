'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/errors';
import { verifyBrowser } from '@/lib/customer-access/verify-browser';

/** Public Server Action: takes only the raw token from the URL and what the customer typed. */
export async function verifyInvoiceAction(
  rawToken: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const result = await verifyBrowser(rawToken, 'INVOICE', formData, 'invoice');
  if (result.ok) revalidatePath(`/customer/invoice/${rawToken}`);
  return result;
}
