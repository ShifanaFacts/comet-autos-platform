'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCurrentUser, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { runAction, toClientResult } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { formDataToObject } from '@/lib/form-data';
import { setOwnPassword } from '@/lib/auth/account';

/** Not `requireUser`: that sends anyone still to choose a password back here. */
export async function setOwnPasswordAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const currentToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value ?? null;
  const result = await runAction(() =>
    setOwnPassword(user, formDataToObject(formData), currentToken),
  );
  if (!result.ok) return toClientResult(result);
  redirect('/');
}
