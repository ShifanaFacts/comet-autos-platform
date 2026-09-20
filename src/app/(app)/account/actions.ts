'use server';

import { cookies } from 'next/headers';
import { requireUser } from '@/lib/auth/authorize';
import { runAction, toClientResult } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { formDataToObject } from '@/lib/form-data';
import { changePassword } from '@/lib/auth/account';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';

export async function changePasswordAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const currentToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value ?? null;
  return toClientResult(
    await runAction(() => changePassword(user, formDataToObject(formData), currentToken)),
  );
}
