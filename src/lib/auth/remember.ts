/*
 * "Remember me": a login that stays signed in — on the website and in the
 * installed app alike — until the person logs out, their password is changed
 * or their access is switched off.
 *
 * It is a session like any other, created with a long life and renewed while
 * it is used: the server extends it in the database (lib/auth/session.ts)
 * and the proxy re-sends the cookie with a fresh lifetime on each visit
 * (src/proxy.ts). Browsers keep a cookie at most 400 days, so a remembered
 * login only lapses after 400 days of not being opened at all.
 *
 * Plain constants and helpers — no imports — so the proxy can use them too.
 */

/** A companion cookie marking the session as remembered, for the proxy's renewals. */
export const REMEMBER_COOKIE_NAME = 'garage_remember';

const DAY_MS = 1000 * 60 * 60 * 24;

/** An ordinary login: 7 days from signing in, as before. */
export const SESSION_TTL_MS = 7 * DAY_MS;

/** A remembered login: the longest a browser keeps a cookie, renewed while used. */
export const REMEMBER_TTL_MS = 400 * DAY_MS;

/** How the session cookie (and its "remembered" companion) are set. */
export function sessionCookieOptions(remember: boolean) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: Math.floor((remember ? REMEMBER_TTL_MS : SESSION_TTL_MS) / 1000),
  };
}

/** A session given a remembered life when it was created (longer than any ordinary one). */
export function isRememberedSession(session: { createdAt: Date; expiresAt: Date }) {
  return session.expiresAt.getTime() - session.createdAt.getTime() > 30 * DAY_MS;
}

/** Renewed at most once a day: when a remembered session has less than its full life left. */
export function needsRenewal(expiresAt: Date, now = Date.now()) {
  return expiresAt.getTime() - now < REMEMBER_TTL_MS - DAY_MS;
}
