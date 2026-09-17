'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revokeSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (rawToken) {
    await revokeSession(rawToken);
  }
  cookieStore.delete(SESSION_COOKIE_NAME);
  redirect('/login');
}
