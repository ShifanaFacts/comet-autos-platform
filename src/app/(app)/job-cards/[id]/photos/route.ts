import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth/session';
import { toActionError } from '@/lib/errors';
import { MAX_PHOTOS_PER_UPLOAD, uploadJobPhotos } from '@/lib/media/photos';

/**
 * Photo upload for a job card (multipart). A route handler rather than a
 * Server Action because photos are larger than the Server Action body
 * limit; it follows the same rules: signed-in user, same-site request,
 * permission and ownership checked in the service, duplicate-safe via the
 * request key, and user-safe error messages.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/job-cards/[id]/photos'>) {
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== request.headers.get('host')) {
    return NextResponse.json({ ok: false, error: 'This request came from another site and was refused.' }, { status: 403 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Your session has ended. Sign in again, then add the photos.' }, { status: 401 });
  const { id } = await ctx.params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'The upload was interrupted. Check the connection and try again.' }, { status: 400 });
  }
  const files = form.getAll('photos').filter((value): value is File => typeof value !== 'string');
  if (files.length > MAX_PHOTOS_PER_UPLOAD) {
    return NextResponse.json({ ok: false, error: `Add up to ${MAX_PHOTOS_PER_UPLOAD} photos at a time.` }, { status: 400 });
  }

  try {
    const buffers = await Promise.all(files.map(async (file) => ({ name: file.name, bytes: Buffer.from(await file.arrayBuffer()) })));
    const documents = await uploadJobPhotos(user, id, buffers, {
      stage: form.get('stage'),
      description: form.get('description') ?? undefined,
      requestKey: form.get('requestKey') ?? undefined,
    });
    revalidatePath(`/job-cards/${id}`);
    return NextResponse.json({ ok: true, count: documents.length });
  } catch (error) {
    const result = toActionError(error);
    if (result.ok) {
      revalidatePath(`/job-cards/${id}`);
      return NextResponse.json({ ok: true, duplicate: true });
    }
    return NextResponse.json({ ok: false, error: result.error, fieldErrors: result.fieldErrors }, { status: 400 });
  }
}
