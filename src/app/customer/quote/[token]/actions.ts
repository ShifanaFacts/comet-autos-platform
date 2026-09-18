'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { runAction, toClientResult } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { decideQuoteAsCustomer, verifyQuoteAccess } from '@/lib/customer-access/quote';
import { ACCESS_COOKIE_MAX_AGE_SECONDS, accessCookieName, hashToken } from '@/lib/customer-access/tokens';

/*
 * Public Server Actions for the customer quotation page. They take only the
 * raw token from the URL plus what the customer typed — never an internal id.
 * No staff session is read or required.
 */

export async function verifyQuoteAction(rawToken: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const plateNumber = String(formData.get('plateNumber') ?? '');
  const phone = String(formData.get('phone') ?? '');
  if (!plateNumber.trim() || !phone.trim()) {
    return { ok: false, error: 'Enter your vehicle registration and mobile number.' };
  }

  const result = await verifyQuoteAccess(rawToken, plateNumber, phone);
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.state === 'expired'
          ? 'This quotation link has expired. Please contact Comet Autos for a new one.'
          : result.state === 'invalid'
            ? 'This link is no longer valid. Please contact Comet Autos.'
            : "Those details don't match our records. Check the registration and the mobile number we have for you.",
    };
  }

  const store = await cookies();
  store.set(accessCookieName(result.tokenHash), result.proof, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/customer/quote',
    maxAge: ACCESS_COOKIE_MAX_AGE_SECONDS,
  });
  revalidatePath(`/customer/quote/${rawToken}`);
  return { ok: true };
}

export async function decideQuoteAction(rawToken: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const decision = formData.get('decision');
  if (decision !== 'APPROVED' && decision !== 'REJECTED') {
    return { ok: false, error: 'Choose approve or reject.' };
  }
  const store = await cookies();
  const proof = store.get(accessCookieName(hashToken(rawToken)))?.value;
  const result = await runAction(() =>
    decideQuoteAsCustomer(rawToken, proof, decision, String(formData.get('notes') ?? '') || null),
  );
  if (result.ok) revalidatePath(`/customer/quote/${rawToken}`);
  return toClientResult(result);
}
