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

/**
 * A repeated submission of a form whose first submission already succeeded
 * (see lib/request-keys.ts). Not a failure: actions answer it as success,
 * pointing at what the first submission created.
 */
export class DuplicateSubmissionError extends DomainError {
  constructor(readonly resultId: string | null) {
    super('This was already saved — the form was submitted twice, so it was only recorded once.');
    this.name = 'DuplicateSubmissionError';
  }
}

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  data?: T;
  /** Set when this submission repeated one that had already been saved. */
  duplicate?: boolean;
  /** For a duplicate: the id of the record the first submission created, when known. */
  duplicateOf?: string | null;
}

const UNIQUE_MESSAGES: { match: string; field: string; message: string }[] = [
  {
    match: 'plate_number',
    field: 'plateNumber',
    message: 'A vehicle with this registration is already on file.',
  },
  {
    match: 'plateNumber',
    field: 'plateNumber',
    message: 'A vehicle with this registration is already on file.',
  },
  { match: 'vin', field: 'vin', message: 'A vehicle with this VIN is already on file.' },
  { match: 'sku', field: 'sku', message: 'This part number is already in the catalogue.' },
  {
    match: 'supplier_invoice',
    field: 'supplierInvoiceNumber',
    message: 'This supplier invoice has already been entered.',
  },
];

/**
 * Converts any thrown error into a user-safe ActionResult. Unique-constraint
 * violations become friendly field errors; permission failures become a
 * generic "not allowed"; unknown errors are logged server-side and reported
 * without internals.
 */
export function toActionError(error: unknown): ActionResult<never> {
  if (error instanceof DuplicateSubmissionError) {
    return { ok: true, duplicate: true, duplicateOf: error.resultId };
  }
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
    return {
      ok: false,
      error:
        "Your account isn't allowed to do this. Nothing was changed — ask the workshop owner or manager if you need access.",
    };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = JSON.stringify(error.meta ?? {});
    const known = UNIQUE_MESSAGES.find((entry) => target.includes(entry.match));
    if (known) {
      return { ok: false, error: known.message, fieldErrors: { [known.field]: known.message } };
    }
    return { ok: false, error: 'That record already exists, so nothing new was saved.' };
  }
  console.error(error);
  return { ok: false, error: systemFailureMessage(error) };
}

const KEPT = 'Nothing was saved, and what you entered is still on the form.';

/**
 * A plain explanation of an unexpected failure, by its cause: the database
 * unreachable, a timeout, two people changing the same thing at once. Never
 * the technical detail itself — that stays in the server log.
 */
export function systemFailureMessage(error: unknown): string {
  const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
  const text = error instanceof Error ? `${error.name} ${error.message}` : '';
  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    /ECONNREFUSED|ECONNRESET|ETIMEDOUT|P1001|P1002|P1017|Can't reach database/.test(text) ||
    code === 'P1001' ||
    code === 'P1017'
  ) {
    return `The workshop database can't be reached right now. ${KEPT} Check the network connection and try again.`;
  }
  if (code === 'P2034' || /deadlock|could not serialize/i.test(text)) {
    return `Someone else changed this at the same moment. ${KEPT} Please try again.`;
  }
  if (code === 'P2024' || code === 'P2028' || /timed out|timeout/i.test(text)) {
    return `The system took too long to respond. ${KEPT} Please try again in a moment.`;
  }
  if (code === 'P2025' || code === 'P2003') {
    return 'Something this depends on was changed or removed by someone else. Refresh the page to see the latest, then try again.';
  }
  return `We couldn't complete this. ${KEPT} Please try again — if it keeps happening, tell the workshop manager.`;
}
