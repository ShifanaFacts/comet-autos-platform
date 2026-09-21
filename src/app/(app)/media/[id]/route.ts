import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { AuthError } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { authorizeJobMedia, readAuthorizedMedia } from '@/lib/media/photos';

/**
 * Serves a job photo or signature by document id to a signed-in user who
 * may see the job. The storage location is never exposed. A document's
 * bytes never change, so the browser may keep it privately for a day and
 * revalidate with the tag rather than downloading it again.
 */
export async function GET(request: NextRequest, ctx: RouteContext<'/media/[id]'>) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Sign in to view this file.', { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Not found', { status: 404 });
  try {
    // Permission first, always: a 304 must never be the thing that tells
    // someone a file exists. Only then is it worth reading the bytes.
    const document = await authorizeJobMedia(user, id);
    const etag = `"${id}"`;
    if (request.headers.get('if-none-match') === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: etag, 'Cache-Control': 'private, max-age=86400, immutable' },
      });
    }
    const bytes = await readAuthorizedMedia(document);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': document.mimeType,
        'Content-Length': String(bytes.length),
        ETag: etag,
        'Content-Disposition': `inline; filename="${document.fileName.replace(/[^\w .()-]/g, '_')}"`,
        'Cache-Control': 'private, max-age=86400, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) return new NextResponse('Not found', { status: 404 });
    if (error instanceof AuthError) return new NextResponse('Forbidden', { status: 403 });
    throw error;
  }
}
