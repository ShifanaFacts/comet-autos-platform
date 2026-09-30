import { requireUser, AuthError } from '@/lib/auth/authorize';
import { exportAuditLog } from '@/lib/access/audit';
import { csvFileName } from '@/lib/data-transfer/csv';
import { getBrand } from '@/lib/brand/brand';

/*
 * The audit log as a spreadsheet: exactly the rows the filters in the query
 * string select. Needs Audit log → View and Export; anyone else gets a
 * plain not-found, as with every other download.
 */
export async function GET(request: Request) {
  const user = await requireUser();
  const search = new URL(request.url).searchParams;
  try {
    const csv = await exportAuditLog(user, {
      from: search.get('from') ?? undefined,
      to: search.get('to') ?? undefined,
      who: search.get('who') ?? undefined,
      module: search.get('module') ?? undefined,
      type: search.get('type') ?? undefined,
    });
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${csvFileName((await getBrand(user.organizationId)).filePrefix, 'Audit log')}"`,
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    if (error instanceof AuthError) return new Response('Not found', { status: 404 });
    throw error;
  }
}
