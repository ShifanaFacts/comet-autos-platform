import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { runAttendanceReminders } from '@/lib/notifications/reminders';

/*
 * The scheduled job behind the check-in and check-out reminders. Something
 * outside the app calls it every few minutes — Vercel Cron, Supabase
 * pg_cron, or any cron service — with the shared secret:
 *
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Without CRON_SECRET set, it refuses everything. Running it more often
 * than needed is harmless: each reminder goes to each person once a day.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return new NextResponse('Unauthorized', { status: 401 });
  const result = await runAttendanceReminders();
  return NextResponse.json({ ok: true, ...result });
}
