import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';

// Edge proxy (formerly "middleware") only does a cheap cookie-presence check
// for UX redirects (Prisma's Node driver adapter can't run in the Edge
// runtime). The actual session/permission validation — the real security
// boundary — happens on every request in requireUser()/requirePermission()
// (see lib/auth/), which run in the Node.js runtime inside Server
// Components and Server Actions.
export function proxy(request: NextRequest) {
  const isPublicRoute =
    request.nextUrl.pathname.startsWith('/login') ||
    request.nextUrl.pathname.startsWith('/customer/');

  if (isPublicRoute) {
    return NextResponse.next();
  }

  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);
  if (!hasSessionCookie) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
