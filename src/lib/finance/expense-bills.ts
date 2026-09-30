import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { DomainError, NotFoundError } from '@/lib/errors';
import { getStorage, sniffImage } from '@/lib/storage';

/*
 * The supplier's bill behind an expense — the evidence an auditor asks for,
 * and what the FTA requires to be kept (a tax invoice to recover the VAT on
 * it, held for at least five years). Stored as a Document (category
 * SUPPLIER_BILL) against the expense; bytes go to the storage driver under
 * an application key; served only through a permission-checked route.
 *
 * A photo of the bill (JPEG, PNG, WebP) or the PDF the supplier emailed.
 * Checked by its bytes, never its name. Removing one is a soft delete: the
 * record and the file are kept, marked removed and by whom.
 */

export const MAX_BILL_BYTES = 10 * 1024 * 1024;

const ENTITY = 'Expense';

/** An image by its magic numbers, or a PDF by its header. */
function sniffBill(bytes: Buffer) {
  const image = sniffImage(bytes);
  if (image) return image;
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') {
    return { mimeType: 'application/pdf' as const, extension: 'pdf' as const };
  }
  return null;
}

async function loadExpense(organizationId: string, expenseId: string) {
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, organizationId },
    select: { id: true, branchId: true, expenseNumber: true, description: true },
  });
  if (!expense) throw new NotFoundError('expense');
  return expense;
}

/** Keeps the supplier's bill with an expense. */
export async function attachExpenseBill(
  user: AuthenticatedUser,
  expenseId: string,
  file: { name: string; bytes: Buffer },
) {
  const expense = await loadExpense(user.organizationId, expenseId);
  requirePermission(user, 'expense.create');
  if (file.bytes.length === 0) throw new DomainError(`“${file.name}” is empty.`, 'bill');
  if (file.bytes.length > MAX_BILL_BYTES) {
    throw new DomainError(`“${file.name}” is larger than 10 MB.`, 'bill');
  }
  const type = sniffBill(file.bytes);
  if (!type) {
    throw new DomainError(`“${file.name}” isn’t a photo (JPEG, PNG, WebP) or a PDF.`, 'bill');
  }
  const key = `org/${user.organizationId}/expenses/${expense.id}/${randomUUID()}.${type.extension}`;
  await getStorage().put(key, file.bytes, type.mimeType);

  return prisma.$transaction(async (tx) => {
    const document = await tx.document.create({
      data: {
        organizationId: user.organizationId,
        branchId: expense.branchId,
        entityType: ENTITY,
        entityId: expense.id,
        documentType: 'SUPPLIER_BILL',
        fileName: file.name.replace(/[^\w .()-]/g, '_').slice(0, 120) || `bill.${type.extension}`,
        storageKey: key,
        mimeType: type.mimeType,
        fileSize: file.bytes.length,
        uploadedByUserId: user.id,
      },
      select: { id: true },
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: expense.branchId,
      actorUserId: user.id,
      action: 'expense.bill_attached',
      entityType: ENTITY,
      entityId: expense.id,
      afterData: { documentId: document.id, fileName: file.name, size: file.bytes.length },
    });
    return document;
  });
}

/** The bills kept against each of these expenses, oldest first. */
export async function listExpenseBills(user: AuthenticatedUser, expenseIds: string[]) {
  requirePermission(user, 'expense.view');
  if (expenseIds.length === 0) return new Map<string, { id: string; fileName: string }[]>();
  const documents = await prisma.document.findMany({
    where: {
      organizationId: user.organizationId,
      entityType: ENTITY,
      entityId: { in: expenseIds },
      documentType: 'SUPPLIER_BILL',
      deletedAt: null,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, entityId: true, fileName: true },
  });
  const byExpense = new Map<string, { id: string; fileName: string }[]>();
  for (const document of documents) {
    const list = byExpense.get(document.entityId) ?? [];
    list.push({ id: document.id, fileName: document.fileName });
    byExpense.set(document.entityId, list);
  }
  return byExpense;
}

/** A bill the user may open, with its bytes. */
export async function readExpenseBill(user: AuthenticatedUser, documentId: string) {
  requirePermission(user, 'expense.view');
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      organizationId: user.organizationId,
      entityType: ENTITY,
      documentType: 'SUPPLIER_BILL',
      deletedAt: null,
    },
    select: { id: true, fileName: true, mimeType: true, storageKey: true },
  });
  if (!document) throw new NotFoundError('bill');
  const bytes = await getStorage().get(document.storageKey);
  if (!bytes) throw new NotFoundError('bill');
  return { ...document, bytes };
}

/** Removes a bill attached in error (soft delete: the record and file are kept). */
export async function removeExpenseBill(user: AuthenticatedUser, documentId: string) {
  requirePermission(user, 'expense.edit');
  return prisma.$transaction(async (tx) => {
    const document = await tx.document.findFirst({
      where: {
        id: documentId,
        organizationId: user.organizationId,
        entityType: ENTITY,
        documentType: 'SUPPLIER_BILL',
        deletedAt: null,
      },
      select: { id: true, entityId: true, fileName: true, branchId: true },
    });
    if (!document) throw new NotFoundError('bill');
    await tx.document.update({
      where: { id: document.id },
      data: { deletedAt: new Date(), deletedByUserId: user.id },
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: document.branchId,
      actorUserId: user.id,
      action: 'expense.bill_removed',
      entityType: ENTITY,
      entityId: document.entityId,
      beforeData: { documentId: document.id, fileName: document.fileName },
    });
    return { expenseId: document.entityId };
  });
}
