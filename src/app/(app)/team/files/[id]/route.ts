import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { AuthError } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { readAuthorizedMedia } from '@/lib/media/photos';
import { authorizeTaskMedia } from '@/lib/team/tasks';

/**
 * Serves a task's photo or voice note to someone who may see the task.
 * Same rules as job photos: permission first, then the bytes; the storage
 * location is never exposed; a file's bytes never change.
 */
export async function GET(request: NextRequest, ctx: RouteContext<'/team/files/[id]'>) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Sign in to view this file.', { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Not found', { status: 404 });
  try {
    const document = await authorizeTaskMedia(user, id);
    const etag = `"${id}"`;
    const cache = 'private, max-age=86400, immutable';
    if (request.headers.get('if-none-match') === etag) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag, 'Cache-Control': cache } });
    }
    const bytes = await readAuthorizedMedia(document);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': document.mimeType,
        'Content-Length': String(bytes.length),
        ETag: etag,
        'Content-Disposition': `inline; filename="${document.fileName.replace(/[^\w .()-]/g, '_')}"`,
        'Cache-Control': cache,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy':
          "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) return new NextResponse('Not found', { status: 404 });
    if (error instanceof AuthError) return new NextResponse('Forbidden', { status: 403 });
    throw error;
  }
}
