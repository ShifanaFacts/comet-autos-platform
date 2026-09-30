import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { AuthError } from '@/lib/auth/authorize';
import { toActionError } from '@/lib/errors';
import { readBill, readBillPdf, type BillTarget } from '@/lib/bill-reader/read';

/**
 * Reads a supplier's bill into a draft for the expense or purchase form.
 *
 * Two shapes, one multipart request: `text` — what the browser's OCR read
 * from a photo — or `file`, a PDF whose own text layer is read here. It
 * answers with the draft (or `needsOcr` for a scanned PDF) and saves
 * nothing: the file is not stored and no row is written. A route handler,
 * not a Server Action, because a PDF can pass the action body limit.
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== request.headers.get('host')) {
    return NextResponse.json(
      { ok: false, error: 'This request came from another site and was refused.' },
      { status: 403 },
    );
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: 'Your session has ended. Sign in again, then scan the bill.' },
      { status: 401 },
    );
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'The upload was interrupted. Check the connection and try again.' },
      { status: 400 },
    );
  }
  const target = form.get('target');
  if (target !== 'expense' && target !== 'purchase') {
    return NextResponse.json({ ok: false, error: 'Choose what the bill is for.' }, { status: 400 });
  }
  try {
    const file = form.get('file');
    if (file && typeof file !== 'string') {
      const result = await readBillPdf(
        user,
        target as BillTarget,
        Buffer.from(await file.arrayBuffer()),
      );
      return NextResponse.json({ ok: true, ...result });
    }
    const draft = await readBill(user, target as BillTarget, String(form.get('text') ?? ''));
    return NextResponse.json({ ok: true, needsOcr: false, draft });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, error: 'You don’t have permission to record this, so the bill wasn’t read.' },
        { status: 403 },
      );
    }
    return NextResponse.json({ ok: false, error: toActionError(error).error }, { status: 400 });
  }
}
