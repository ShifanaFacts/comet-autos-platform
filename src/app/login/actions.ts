'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/auth/password';
import { createSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { phoneCore } from '@/lib/normalize';

export interface LoginState {
  error?: string;
  /** What the user typed as their email or mobile, so a failed attempt doesn't clear it. */
  identifier?: string;
}

const INVALID_CREDENTIALS_MESSAGE = 'Email/mobile number or password is incorrect.';

/** Only same-site paths are accepted as a return address after login. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === 'string' ? value : '';
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/';
}

/**
 * Finds the active user by email, or by mobile number (compared on its
 * national digits, so "050 123 4567" and "+971501234567" match). Comet Autos
 * is a single-business deployment, so there is exactly one organization.
 */
async function findUser(identifier: string) {
  if (identifier.includes('@')) {
    return prisma.user.findFirst({ where: { email: identifier.toLowerCase(), isActive: true } });
  }
  const core = phoneCore(identifier);
  if (core.length < 7) return null;
  const candidates = await prisma.user.findMany({
    where: { isActive: true, phone: { not: null } },
    select: { id: true, phone: true },
  });
  const matches = candidates.filter((candidate) => phoneCore(candidate.phone!) === core);
  // Ambiguous numbers are refused rather than guessed.
  return matches.length === 1 ? prisma.user.findUnique({ where: { id: matches[0].id } }) : null;
}

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const identifier = String(formData.get('identifier') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!identifier || !password) {
    return { identifier, error: 'Enter your email or mobile number and your password.' };
  }

  const user = await findUser(identifier);
  // The same answer whether the account or the password is wrong, so the form can't be used to find accounts.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { identifier, error: INVALID_CREDENTIALS_MESSAGE };
  }

  const rawToken = await createSession(user.id, user.organizationId);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  redirect(safeNext(formData.get('next')));
}
