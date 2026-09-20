import { cookies } from 'next/headers';
import type { CustomerAccessResourceType } from '@/generated/prisma/enums';
import type { ActionResult } from '@/lib/errors';
import { ACCESS_COOKIE_MAX_AGE_SECONDS, hashToken } from '@/lib/customer-access/tokens';
import { customerAccessCookie, verifyCustomerAccess } from '@/lib/customer-access/access';

/**
 * Checks the registration + mobile number a customer typed for a link and,
 * when they match, remembers it in an httpOnly cookie bound to that link.
 * Used by the public Server Actions of the customer pages.
 */
export async function verifyBrowser(
  rawToken: string,
  type: CustomerAccessResourceType,
  formData: FormData,
  documentName: string,
): Promise<ActionResult> {
  const plateNumber = String(formData.get('plateNumber') ?? '');
  const phone = String(formData.get('phone') ?? '');
  if (!plateNumber.trim() || !phone.trim()) {
    return { ok: false, error: 'Enter your vehicle registration and mobile number.' };
  }

  const result = await verifyCustomerAccess(rawToken, type, plateNumber, phone);
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.state === 'expired'
          ? `This ${documentName} link has expired. Please contact the workshop for a new one.`
          : result.state === 'invalid'
            ? 'This link is no longer valid. Please contact the workshop.'
            : "Those details don't match our records. Check the registration and the mobile number we have for you.",
    };
  }

  const cookie = customerAccessCookie(type, result.tokenHash);
  const store = await cookies();
  store.set(cookie.name, result.proof, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: cookie.path,
    maxAge: ACCESS_COOKIE_MAX_AGE_SECONDS,
  });
  return { ok: true };
}

/** The proof this browser holds for a link, if any. */
export async function browserProof(rawToken: string, type: CustomerAccessResourceType) {
  const store = await cookies();
  return store.get(customerAccessCookie(type, hashToken(rawToken)).name)?.value;
}
