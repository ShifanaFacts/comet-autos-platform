import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { openNotification } from '@/lib/notifications/service';

/**
 * Tapping a notification — in the bell or on the phone — comes here: it is
 * marked read and the person lands where it points. Only ever an address
 * inside the app.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL('/login', request.url));
  const { id } = await params;
  const notification = /^[0-9a-f-]{36}$/i.test(id) ? await openNotification(user, id) : null;
  const target = notification?.href?.startsWith('/') && !notification.href.startsWith('//') ? notification.href : '/';
  return NextResponse.redirect(new URL(target, request.url));
}
