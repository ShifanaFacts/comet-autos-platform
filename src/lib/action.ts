import { unstable_rethrow } from 'next/navigation';
import { toActionError, type ActionResult } from '@/lib/errors';

/**
 * Runs a Server Action body and converts failures into a user-safe
 * ActionResult. Next.js control-flow errors (redirect/notFound) are
 * rethrown untouched.
 */
export async function runAction<T>(body: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await body();
    return { ok: true, data };
  } catch (error) {
    unstable_rethrow(error);
    return toActionError(error);
  }
}

/** Drops the data payload (e.g. Prisma rows with Dates) before a result crosses to the client. */
export function toClientResult(result: ActionResult<unknown>): ActionResult {
  return { ok: result.ok, error: result.error, fieldErrors: result.fieldErrors };
}
