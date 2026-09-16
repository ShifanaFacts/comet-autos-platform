'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/auth/password';
import { createSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1, 'Password is required'),
});

export interface LoginState {
  error?: string;
}

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password.';

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: INVALID_CREDENTIALS_MESSAGE };
  }

  // Comet Autos is a single-business deployment (not multi-tenant SaaS), so
  // login resolves by email alone — there is exactly one Organization row
  // in practice. The `email` uniqueness constraint is still per-organization
  // at the schema level (forward-looking), hence findFirst, not a unique
  // lookup by email.
  const user = await prisma.user.findFirst({
    where: { email: parsed.data.email, isActive: true },
  });

  if (!user) {
    return { error: INVALID_CREDENTIALS_MESSAGE };
  }

  const passwordMatches = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!passwordMatches) {
    return { error: INVALID_CREDENTIALS_MESSAGE };
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

  redirect('/');
}
