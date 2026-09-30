import type { AuthenticatedUser } from '@/lib/auth/session';
import { NotFoundError } from '@/lib/errors';
import {
  attachFile,
  listAttachments,
  MAX_ATTACHMENT_BYTES,
  readAttachment,
  removeAttachment,
} from '@/lib/documents/attachments';

/*
 * The supplier's bill behind an expense — the evidence an auditor asks for,
 * and what the FTA requires to be kept (a tax invoice to recover the VAT on
 * it, held for at least five years). Stored as a Document (category
 * SUPPLIER_BILL) against the expense.
 *
 * The rules — file types, size, storage, permissions, soft delete, audit —
 * are the shared ones in `lib/documents/attachments`; this is the expense's
 * own face on them.
 */

export const MAX_BILL_BYTES = MAX_ATTACHMENT_BYTES;

/** A missing bill is reported as a bill, whatever the shared module calls it. */
async function asBill<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof NotFoundError && error.message.includes('file'))
      throw new NotFoundError('bill');
    throw error;
  }
}

/** Keeps the supplier's bill with an expense. */
export function attachExpenseBill(
  user: AuthenticatedUser,
  expenseId: string,
  file: { name: string; bytes: Buffer },
  options: { note?: string | null } = {},
) {
  return attachFile(user, 'Expense', expenseId, file, { ...options, field: 'bill' });
}

/** The bills kept against each of these expenses, oldest first. */
export function listExpenseBills(user: AuthenticatedUser, expenseIds: string[]) {
  return listAttachments(user, 'Expense', expenseIds);
}

/** A bill the user may open, with its bytes. */
export function readExpenseBill(user: AuthenticatedUser, documentId: string) {
  return asBill(readAttachment(user, 'Expense', documentId));
}

/** Removes a bill attached in error (soft delete: the record and file are kept). */
export async function removeExpenseBill(user: AuthenticatedUser, documentId: string) {
  const removed = await asBill(removeAttachment(user, 'Expense', documentId));
  return { expenseId: removed.entityId };
}
