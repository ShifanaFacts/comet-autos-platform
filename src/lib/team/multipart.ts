import { NextResponse, type NextRequest } from 'next/server';
import { toActionError } from '@/lib/errors';
import type { IncomingFile } from '@/lib/team/tasks';

/*
 * The shared half of the task upload routes. Route handlers rather than
 * Server Actions because photos and a voice note together are larger than
 * the Server Action body limit; they keep the same rules — same-site only,
 * signed-in user, everything else checked in the service.
 */

export function refuseCrossSite(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== request.headers.get('host')) {
    return NextResponse.json(
      { ok: false, error: 'This request came from another site and was refused.' },
      { status: 403 },
    );
  }
  return null;
}

/** The form, or null when the upload broke off part-way. */
export async function readForm(request: NextRequest) {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

async function toIncoming(file: File): Promise<IncomingFile> {
  return { name: file.name || 'file', bytes: Buffer.from(await file.arrayBuffer()) };
}

/** The photos and the (optional) voice note sent with a form. */
export async function filesOf(form: FormData) {
  const photos = form
    .getAll('photos')
    .filter((value): value is File => typeof value !== 'string' && value.size > 0);
  const voice = form.get('voice');
  return {
    // The service refuses more than it keeps; this only bounds the reading.
    photos: await Promise.all(photos.slice(0, 20).map(toIncoming)),
    voice: voice && typeof voice !== 'string' && voice.size > 0 ? await toIncoming(voice) : null,
  };
}

/** A form value as the service expects it: a string or nothing. */
export function text(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === 'string' ? value : undefined;
}

export function sessionEnded() {
  return NextResponse.json(
    { ok: false, error: 'Your session has ended. Sign in again, then save.' },
    { status: 401 },
  );
}

export function interrupted() {
  return NextResponse.json(
    { ok: false, error: 'The upload was interrupted. Check the connection and try again.' },
    { status: 400 },
  );
}

/** A service failure as JSON — a repeated submission counts as success. */
export function failure(error: unknown) {
  const result = toActionError(error);
  if (result.ok) return NextResponse.json({ ok: true, duplicate: true });
  return NextResponse.json(
    { ok: false, error: result.error, fieldErrors: result.fieldErrors },
    { status: 400 },
  );
}
