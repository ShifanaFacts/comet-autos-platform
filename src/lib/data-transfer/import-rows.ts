import type { Prisma } from '@/generated/prisma/client';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { AuthError } from '@/lib/auth/authorize';
import { DomainError } from '@/lib/errors';

/*
 * What every importer shares: the shape of a definition, the report it
 * fills in, and how a row that fails is written into that report.
 */

export interface ImportColumn {
  header: string;
  required?: boolean;
  example?: string;
  hint?: string;
}

export interface ImportOutcome {
  /** Rows written — or, for documents, documents written. */
  created: number;
  /** Rows that already existed, with what matched. */
  skipped: { row: number; reason: string }[];
  /** Rows that could not be read. Any of these and nothing is written. */
  errors: { row: number; message: string }[];
  total: number;
}

export interface ImportDefinition {
  label: string;
  /** What the list is called on screen, for the report. */
  noun: string;
  permission: string;
  columns: ImportColumn[];
  /** How the file is laid out, shown above the columns when it isn't one row per record. */
  note?: string;
  /** A second example row for the template, e.g. another line of the same document. */
  secondExample?: Record<string, string>;
  run: (
    tx: Prisma.TransactionClient,
    user: AuthenticatedUser,
    records: Record<string, string>[],
    outcome: ImportOutcome,
  ) => Promise<void>;
}

/** Row numbers in the report are the spreadsheet's own (header is row 1). */
export const rowNumber = (index: number) => index + 2;

export function fail(outcome: ImportOutcome, index: number, error: unknown) {
  const message =
    error instanceof DomainError
      ? error.message
      : error instanceof AuthError
        ? 'Your account is not allowed to add what this row needs.'
        : 'This row could not be read. Check the columns against the template.';
  outcome.errors.push({ row: rowNumber(index), message });
}

/**
 * An account named in a cell however it was written — its code ("5240"), its
 * name ("Printing & stationery"), or both ("5240 Printing & stationery",
 * "5240 - Printing") — found in a map keyed by lower-case code and name.
 */
export function lookupAccount(byCodeOrName: Map<string, string>, text: string) {
  const value = text.trim().toLowerCase();
  if (!value) return undefined;
  const code = /^(\d{3,6})\b/.exec(value)?.[1];
  const name = value.replace(/^\d{3,6}\s*[-–—:.]?\s*/, '');
  return (
    byCodeOrName.get(value) ?? (code ? byCodeOrName.get(code) : undefined) ?? byCodeOrName.get(name)
  );
}
