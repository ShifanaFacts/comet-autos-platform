import type { Prisma } from '@/generated/prisma/client';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { DuplicateSubmissionError } from '@/lib/errors';

export { DuplicateSubmissionError };

/*
 * Duplicate-safe submissions. Every form sends a one-time `requestKey`
 * (useFormAction adds it). A service that creates something which can
 * legitimately happen many times — a payment, a part fitted, labour, an
 * appointment, a check-in — claims the key inside its own transaction:
 *
 *   await claimRequestKey(tx, user, rawInput, 'payment.record');
 *   ...create the record...
 *   await settleRequestKey(tx, user, rawInput, payment.id);
 *
 * The unique index on (organization, user, key) makes the claim atomic: a
 * second submission of the same form — a double click, or a retry after a
 * slow response — waits for the first to finish and then finds the key
 * taken. It gets a DuplicateSubmissionError carrying the first result's id,
 * which Server Actions treat as success. If the first attempt failed, its
 * transaction rolled the key back with it, so a retry goes through.
 *
 * Calls without a key (scripts, tests, older callers) behave as before.
 */

const KEY_PATTERN = /^[A-Za-z0-9-]{16,64}$/;

/** The request key a form sent, if it is well-formed. */
export function requestKeyOf(rawInput: unknown): string | null {
  const key = (rawInput as { requestKey?: unknown } | null)?.requestKey;
  return typeof key === 'string' && KEY_PATTERN.test(key) ? key : null;
}

/** Claims the submission's key, or throws DuplicateSubmissionError if it was already used. */
export async function claimRequestKey(
  tx: Prisma.TransactionClient,
  user: AuthenticatedUser,
  rawInput: unknown,
  action: string,
) {
  const key = requestKeyOf(rawInput);
  if (!key) return;
  const claimed = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO request_keys (id, organization_id, user_id, request_key, action)
    VALUES (gen_random_uuid(), ${user.organizationId}::uuid, ${user.id}::uuid, ${key}, ${action})
    ON CONFLICT (organization_id, user_id, request_key) DO NOTHING
    RETURNING id`;
  if (claimed.length > 0) return;
  const previous = await tx.requestKey.findUnique({
    where: {
      organizationId_userId_requestKey: {
        organizationId: user.organizationId,
        userId: user.id,
        requestKey: key,
      },
    },
    select: { resultId: true },
  });
  throw new DuplicateSubmissionError(previous?.resultId ?? null);
}

/** Records what the submission created, so a repeat of it can lead there. */
export async function settleRequestKey(
  tx: Prisma.TransactionClient,
  user: AuthenticatedUser,
  rawInput: unknown,
  resultId: string,
) {
  const key = requestKeyOf(rawInput);
  if (!key) return;
  await tx.requestKey.update({
    where: {
      organizationId_userId_requestKey: {
        organizationId: user.organizationId,
        userId: user.id,
        requestKey: key,
      },
    },
    data: { resultId },
  });
}
