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
};

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
  branchId: string,
  documentType: DocumentType,
): Promise<string> {
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
  const locked = await tx.documentNumberSequence.findUniqueOrThrow({ where: { id: sequence.id } });

  await tx.documentNumberSequence.update({
    where: { id: locked.id },
    data: { nextNumber: locked.nextNumber + 1 },
  });

  return `${locked.prefix}${String(locked.nextNumber).padStart(locked.padding, '0')}`;
}
