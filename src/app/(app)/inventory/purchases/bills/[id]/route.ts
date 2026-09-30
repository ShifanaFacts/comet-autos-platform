import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { AuthError } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { readAttachment } from '@/lib/documents/attachments';

/** Opens a supplier's bill kept against a purchase, for a user who may see purchases. */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<'/inventory/purchases/bills/[id]'>,
) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Sign in to view this file.', { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Not found', { status: 404 });
  try {
    const bill = await readAttachment(user, 'Purchase', id);
    return new NextResponse(new Uint8Array(bill.bytes), {
      headers: {
        'Content-Type': bill.mimeType,
        'Content-Length': String(bill.bytes.length),
        'Content-Disposition': `inline; filename="${bill.fileName.replace(/[^\w .()-]/g, '_')}"`,
        'Cache-Control': 'private, max-age=86400, immutable',
        'X-Content-Type-Options': 'nosniff',
        // Images get a locked-down page; a PDF needs the browser's own viewer.
        ...(bill.mimeType === 'application/pdf'
          ? {}
          : {
              'Content-Security-Policy':
                "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
            }),
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) return new NextResponse('Not found', { status: 404 });
    if (error instanceof AuthError) return new NextResponse('Forbidden', { status: 403 });
    throw error;
  }
}
