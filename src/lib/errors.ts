import { Prisma } from '@/generated/prisma/client';
import { AuthError } from '@/lib/auth/authorize';

/**
 * A business-rule violation whose message is safe and useful to show to
 * staff as-is ("This vehicle is already registered", "Complete the
 * inspection before recording a diagnosis"). Anything that is NOT a
 * DomainError is treated as unexpected and never shown verbatim.
 */
export class DomainError extends Error {
  constructor(
    message: string,
    /** Optional form field the message belongs to. */
    readonly field?: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

/** Thrown when a record doesn't exist *or* the caller may not see it — deliberately indistinguishable. */
export class NotFoundError extends DomainError {
  constructor(what = 'record') {
    super(`That ${what} could not be found.`);
    this.name = 'NotFoundError';
  }
}

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  data?: T;
}

const UNIQUE_MESSAGES: { match: string; field: string; message: string }[] = [
  { match: 'plate_number', field: 'plateNumber', message: 'A vehicle with this registration is already on file.' },
  { match: 'plateNumber', field: 'plateNumber', message: 'A vehicle with this registration is already on file.' },
  { match: 'vin', field: 'vin', message: 'A vehicle with this VIN is already on file.' },
];

/**
 * Converts any thrown error into a user-safe ActionResult. Unique-constraint
 * violations become friendly field errors; permission failures become a
 * generic "not allowed"; unknown errors are logged server-side and reported
 * without internals.
 */
export function toActionError(error: unknown): ActionResult<never> {
  if (error instanceof DomainError) {
    return {
      ok: false,
      error: error.message,
      fieldErrors:
        (error as { fieldErrors?: Record<string, string> }).fieldErrors ??
        (error.field ? { [error.field]: error.message } : undefined),
    };
  }
  if (error instanceof AuthError) {
    return { ok: false, error: "You don't have permission to do that." };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = JSON.stringify(error.meta ?? {});
    const known = UNIQUE_MESSAGES.find((entry) => target.includes(entry.match));
    if (known) {
      return { ok: false, error: known.message, fieldErrors: { [known.field]: known.message } };
    }
    return { ok: false, error: 'That record already exists.' };
  }
  console.error(error);
  return { ok: false, error: 'Something went wrong. Please try again.' };
}
