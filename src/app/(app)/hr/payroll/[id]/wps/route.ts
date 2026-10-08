import { requireUser, AuthError } from '@/lib/auth/authorize';
import { DomainError, NotFoundError } from '@/lib/errors';
import { getWpsFile } from '@/lib/hr/wps';

/*
 * The WPS salary file (SIF) for an approved payroll, to upload to the bank or
 * exchange house that pays the team. Only for people who see pay; anyone
 * else gets a plain not-found, as with every other download. While details
 * are missing the run's page lists them and offers no link — asked for
 * anyway, the answer says what is missing.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  try {
    const file = await getWpsFile(user, id);
    if (file.problems.length) {
      return new Response(
        `The salary file can't be made yet. Missing:\n- ${file.problems.join('\n- ')}\n`,
        {
          status: 422,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        },
      );
    }
    return new Response(file.content, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${file.fileName}"`,
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    if (error instanceof AuthError || error instanceof NotFoundError) {
      return new Response('Not found', { status: 404 });
    }
    if (error instanceof DomainError) {
      return new Response(error.message, { status: 409, headers: { 'Cache-Control': 'no-store' } });
    }
    throw error;
  }
}
