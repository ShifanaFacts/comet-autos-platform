import { randomUUID } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import type { SignatureContext, SignerType } from '@/generated/prisma/enums';
import { writeAuditLog } from '@/lib/audit';
import { DomainError } from '@/lib/errors';
import { getStorage, sniffImage } from '@/lib/storage';

/*
 * Optional signatures confirming a customer decision or a vehicle handover.
 * A signature is a record — what was signed, by whom, when, captured how —
 * with its image stored like any file (Document, category SIGNATURE).
 * Never required: the workflows complete without one, and the absence of a
 * Signature row is how "not signed" is recorded.
 */

const MAX_SIGNATURE_BYTES = 1024 * 1024;
const PREFIX = 'data:image/png;base64,';

export interface PreparedSignature {
  key: string;
  bytes: Buffer;
}

/**
 * Validates a signature sent from the signature pad (a PNG data URL) and
 * stores its image. Returns null when no signature was given. Call before
 * the transaction that records it (storage isn't transactional; an unused
 * stored image is harmless and never referenced).
 */
export async function prepareSignature(dataUrl: unknown, organizationId: string, jobCardId: string): Promise<PreparedSignature | null> {
  if (typeof dataUrl !== 'string' || dataUrl.trim() === '') return null;
  if (!dataUrl.startsWith(PREFIX)) throw new DomainError('The signature could not be read. Clear it and sign again.', 'signature');
  const bytes = Buffer.from(dataUrl.slice(PREFIX.length), 'base64');
  if (bytes.length > MAX_SIGNATURE_BYTES) throw new DomainError('The signature is too large. Clear it and sign again.', 'signature');
  if (bytes.length < 100 || sniffImage(bytes)?.mimeType !== 'image/png') {
    throw new DomainError('The signature could not be read. Clear it and sign again.', 'signature');
  }
  const key = `org/${organizationId}/jobs/${jobCardId}/signatures/${randomUUID()}.png`;
  await getStorage().put(key, bytes, 'image/png');
  return { key, bytes };
}

/** Records a prepared signature against its business record, with an audit entry. */
export async function recordSignature(
  tx: Prisma.TransactionClient,
  params: {
    prepared: PreparedSignature;
    organizationId: string;
    branchId: string;
    jobCardId: string;
    context: SignatureContext;
    approvalId?: string | null;
    signerType: SignerType;
    signerName: string;
    customerId?: string | null;
    /** Staff member whose device captured it; null when the customer signed on their own phone. */
    capturedByUserId: string | null;
    /** The user the stored file is attributed to: the capturing staff member, or the staff member who issued the customer's link. */
    fileOwnerUserId: string;
    auditActorUserId: string | null;
  },
) {
  const signerName = params.signerName.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!signerName) throw new DomainError('Enter the name of the person signing.', 'signerName');
  const document = await tx.document.create({
    data: {
      organizationId: params.organizationId,
      branchId: params.branchId,
      entityType: 'JobCard',
      entityId: params.jobCardId,
      jobCardId: params.jobCardId,
      documentType: 'SIGNATURE',
      fileName: `signature-${params.context.toLowerCase()}.png`,
      storageKey: params.prepared.key,
      mimeType: 'image/png',
      fileSize: params.prepared.bytes.length,
      uploadedByUserId: params.fileOwnerUserId,
      description: params.capturedByUserId ? 'Signed on the workshop device' : "Signed on the customer's secure link",
    },
  });
  const signature = await tx.signature.create({
    data: {
      organizationId: params.organizationId,
      jobCardId: params.jobCardId,
      context: params.context,
      approvalId: params.approvalId ?? null,
      signerType: params.signerType,
      signerName,
      customerId: params.customerId ?? null,
      capturedByUserId: params.capturedByUserId,
      documentId: document.id,
    },
  });
  await writeAuditLog(tx, {
    organizationId: params.organizationId,
    branchId: params.branchId,
    actorUserId: params.auditActorUserId,
    action: 'signature.captured',
    entityType: 'Signature',
    entityId: signature.id,
    afterData: { context: params.context, signerType: params.signerType, signerName, approvalId: params.approvalId ?? null },
    metadata: { jobCardId: params.jobCardId, documentId: document.id, capturedOn: params.capturedByUserId ? 'workshop device' : 'customer link' },
  });
  return signature;
}
