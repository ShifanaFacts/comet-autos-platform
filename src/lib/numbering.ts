import type { Prisma } from '@/generated/prisma/client';
import type { DocumentType } from '@/generated/prisma/enums';

const DEFAULT_PREFIX: Record<DocumentType, string> = {
  JOB_CARD: 'JC-',
  ESTIMATE: 'EST-',
  TAX_INVOICE: 'INV-',
  PROFORMA_INVOICE: 'PRO-',
  PURCHASE_ORDER: 'PO-',
  PAYMENT_RECEIPT: 'RCT-',
  EXPENSE_VOUCHER: 'EXP-',
  SUPPLIER_PAYMENT: 'SP-',
  JOURNAL_ENTRY: 'JV-',
  CREDIT_NOTE: 'CN-',
  FIXED_ASSET: 'FA-',
  OPENING_BALANCE: 'OB-',
};

/**
 * The branch's sequence for a document type — or, with no branch, the
 * workshop-wide one (journal entries) — created on first use, and locked
 * (`SELECT ... FOR UPDATE`) until the transaction ends.
 */
async function lockSequence(
  tx: Prisma.TransactionClient,
  organizationId: string,
  branchId: string | null,
  documentType: DocumentType,
) {
  let sequence = await tx.documentNumberSequence.findFirst({
    where: { organizationId, branchId, documentType },
  });

  if (!sequence) {
    try {
      sequence = await tx.documentNumberSequence.create({
        data: { organizationId, branchId, documentType, prefix: DEFAULT_PREFIX[documentType] },
      });
    } catch {
      // Lost a create race against a concurrent transaction — the row now
      // exists, fall through and use it.
      sequence = await tx.documentNumberSequence.findFirstOrThrow({
        where: { organizationId, branchId, documentType },
      });
    }
  }

  await tx.$executeRaw`SELECT id FROM document_number_sequences WHERE id = ${sequence.id}::uuid FOR UPDATE`;
  return tx.documentNumberSequence.findUniqueOrThrow({ where: { id: sequence.id } });
}

/**
 * Allocates the next sequential, zero-padded document number, branch-scoped.
 * Concurrency-safe: locks the DocumentNumberSequence row (`SELECT ... FOR
 * UPDATE`) before reading nextNumber, per the invariant documented on that
 * model in prisma/schema.prisma — must always run inside the same
 * transaction as the document creation it's numbering.
 */
export async function allocateDocumentNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
  branchId: string | null,
  documentType: DocumentType,
): Promise<string> {
  const [number] = await allocateDocumentNumbers(tx, organizationId, branchId, documentType, 1);
  return number;
}

/**
 * `count` consecutive numbers at once — an import numbering many documents
 * takes the lock once rather than once per document.
 */
export async function allocateDocumentNumbers(
  tx: Prisma.TransactionClient,
  organizationId: string,
  branchId: string | null,
  documentType: DocumentType,
  count: number,
): Promise<string[]> {
  if (count <= 0) return [];
  const locked = await lockSequence(tx, organizationId, branchId, documentType);
  await tx.documentNumberSequence.update({
    where: { id: locked.id },
    data: { nextNumber: locked.nextNumber + count },
  });
  return Array.from(
    { length: count },
    (_, index) =>
      `${locked.prefix}${String(locked.nextNumber + index).padStart(locked.padding, '0')}`,
  );
}

/**
 * Documents brought in from another system keep the numbers they were
 * issued with. When one of those looks like ours ("INV-000120"), the
 * sequence moves past it, so a document numbered here later can never
 * collide with an imported one.
 */
export async function reserveImportedNumbers(
  tx: Prisma.TransactionClient,
  organizationId: string,
  branchId: string | null,
  documentType: DocumentType,
  numbers: string[],
): Promise<void> {
  if (numbers.length === 0) return;
  const locked = await lockSequence(tx, organizationId, branchId, documentType);
  const prefix = locked.prefix.toUpperCase();
  let highest = 0;
  for (const number of numbers) {
    const text = number.trim().toUpperCase();
    if (!text.startsWith(prefix)) continue;
    const digits = text.slice(prefix.length);
    if (/^\d{1,9}$/.test(digits)) highest = Math.max(highest, Number(digits));
  }
  if (highest >= locked.nextNumber) {
    await tx.documentNumberSequence.update({
      where: { id: locked.id },
      data: { nextNumber: highest + 1 },
    });
  }
}
