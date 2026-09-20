import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { MediaStage } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { DomainError, NotFoundError } from '@/lib/errors';
import { parseInput } from '@/lib/form-data';
import { emptyToNull } from '@/lib/normalize';
import { claimRequestKey } from '@/lib/request-keys';
import { getStorage, sniffImage } from '@/lib/storage';

export { MEDIA_STAGES } from '@/lib/media/stages';

/*
 * Job-card photos, stored as Documents (category PHOTO) tied to the job and
 * the stage they document. Bytes go to the storage driver under a key the
 * application generates; the database keeps who, when, which job and stage.
 * Files are only ever served by document id through a permission-checked
 * route, after checking the document belongs to the viewer's organization.
 */

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS_PER_UPLOAD = 12;

const uploadSchema = z.object({
  stage: z.enum(['INTAKE', 'INSPECTION', 'DIAGNOSIS', 'REPAIR', 'QUALITY_CHECK', 'DELIVERY', 'GENERAL'], { error: 'Choose which stage the photos are for.' }),
  description: z.string().trim().max(300, 'Keep the caption under 300 characters.').optional(),
  requestKey: z.string().optional(),
});

async function loadJob(organizationId: string, jobCardId: string) {
  const job = await prisma.jobCard.findFirst({ where: { id: jobCardId, organizationId }, select: { id: true, branchId: true, jobNumber: true, status: true } });
  if (!job) throw new NotFoundError('job card');
  return job;
}

/**
 * Adds photos to a job. Every file is checked by its actual bytes (JPEG,
 * PNG or WebP only) and size before anything is stored; then all are stored
 * and recorded together.
 */
export async function uploadJobPhotos(
  user: AuthenticatedUser,
  jobCardId: string,
  files: { name: string; bytes: Buffer }[],
  rawInput: unknown,
) {
  const input = parseInput(uploadSchema, rawInput);
  const job = await loadJob(user.organizationId, jobCardId);
  requirePermission(user, 'job_card.edit', { branchId: job.branchId });
  if (job.status === 'CANCELLED') throw new DomainError('Photos can’t be added to a cancelled job.');
  if (files.length === 0) throw new DomainError('Choose at least one photo.', 'photos');
  if (files.length > MAX_PHOTOS_PER_UPLOAD) throw new DomainError(`Add up to ${MAX_PHOTOS_PER_UPLOAD} photos at a time.`, 'photos');

  const checked = files.map((file) => {
    if (file.bytes.length === 0) throw new DomainError(`“${file.name}” is empty.`, 'photos');
    if (file.bytes.length > MAX_PHOTO_BYTES) throw new DomainError(`“${file.name}” is larger than 10 MB. Take a smaller photo or reduce its size.`, 'photos');
    const type = sniffImage(file.bytes);
    if (!type) throw new DomainError(`“${file.name}” isn’t a JPEG, PNG or WebP photo.`, 'photos');
    return { ...file, type, key: `org/${user.organizationId}/jobs/${job.id}/${randomUUID()}.${type.extension}` };
  });

  const storage = getStorage();
  for (const file of checked) await storage.put(file.key, file.bytes, file.type.mimeType);

  return prisma.$transaction(async (tx) => {
    await claimRequestKey(tx, user, input, 'job_photo.upload');
    const documents = [];
    for (const file of checked) {
      documents.push(
        await tx.document.create({
          data: {
            organizationId: user.organizationId,
            branchId: job.branchId,
            entityType: 'JobCard',
            entityId: job.id,
            jobCardId: job.id,
            documentType: 'PHOTO',
            stage: input.stage,
            description: emptyToNull(input.description),
            fileName: file.name.replace(/[^\w .()-]/g, '_').slice(0, 120) || `photo.${file.type.extension}`,
            storageKey: file.key,
            mimeType: file.type.mimeType,
            fileSize: file.bytes.length,
            uploadedByUserId: user.id,
          },
        }),
      );
    }
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: job.branchId,
      actorUserId: user.id,
      action: 'job_photo.uploaded',
      entityType: 'JobCard',
      entityId: job.id,
      afterData: { stage: input.stage, count: documents.length, documentIds: documents.map((d) => d.id) },
    });
    return documents;
  });
}

/** The job's photos (not removed), oldest first, with who added them. */
export async function listJobPhotos(user: AuthenticatedUser, jobCardId: string) {
  const job = await loadJob(user.organizationId, jobCardId);
  requirePermission(user, 'job_card.view', { branchId: job.branchId });
  const photos = await prisma.document.findMany({
    where: { organizationId: user.organizationId, jobCardId: job.id, documentType: 'PHOTO', deletedAt: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, stage: true, description: true, createdAt: true, fileSize: true, uploadedBy: { select: { fullName: true } } },
  });
  return photos.map((photo) => ({ ...photo, stage: photo.stage ?? ('GENERAL' as MediaStage) }));
}

export type JobPhoto = Awaited<ReturnType<typeof listJobPhotos>>[number];

const removeSchema = z.object({ reason: z.string().trim().max(300).optional() });

/** Removes a photo from the job (soft delete: the record and file are kept, marked removed and by whom). */
export async function removeJobPhoto(user: AuthenticatedUser, documentId: string, rawInput: unknown = {}) {
  const input = parseInput(removeSchema, rawInput);
  const photo = await prisma.document.findFirst({
    where: { id: documentId, organizationId: user.organizationId, documentType: 'PHOTO', jobCardId: { not: null } },
    include: { jobCard: { select: { id: true, branchId: true } } },
  });
  if (!photo?.jobCard) throw new NotFoundError('photo');
  requirePermission(user, 'job_card.edit', { branchId: photo.jobCard.branchId });
  if (photo.deletedAt) return photo;

  return prisma.$transaction(async (tx) => {
    const removed = await tx.document.update({ where: { id: photo.id }, data: { deletedAt: new Date(), deletedByUserId: user.id } });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: photo.jobCard!.branchId,
      actorUserId: user.id,
      action: 'job_photo.removed',
      entityType: 'Document',
      entityId: photo.id,
      beforeData: { stage: photo.stage, description: photo.description },
      metadata: { jobCardId: photo.jobCard!.id, reason: emptyToNull(input.reason) },
    });
    return removed;
  });
}

/**
 * The bytes of a job photo or signature for a signed-in user who may see
 * the job. Other organizations' files, removed photos and other document
 * kinds are reported as not found.
 */
export async function readJobMedia(user: AuthenticatedUser, documentId: string) {
  const document = await prisma.document.findFirst({
    where: { id: documentId, organizationId: user.organizationId, documentType: { in: ['PHOTO', 'SIGNATURE'] }, deletedAt: null, jobCardId: { not: null } },
    select: { storageKey: true, mimeType: true, fileName: true, jobCard: { select: { branchId: true } } },
  });
  if (!document?.jobCard) throw new NotFoundError('file');
  requirePermission(user, 'job_card.view', { branchId: document.jobCard.branchId });
  const bytes = await getStorage().get(document.storageKey);
  if (!bytes) throw new NotFoundError('file');
  return { bytes, mimeType: document.mimeType, fileName: document.fileName };
}

/** The job's signatures (approval, handover), for the job card. */
export async function listJobSignatures(user: AuthenticatedUser, jobCardId: string) {
  const job = await loadJob(user.organizationId, jobCardId);
  requirePermission(user, 'job_card.view', { branchId: job.branchId });
  return prisma.signature.findMany({
    where: { organizationId: user.organizationId, jobCardId: job.id },
    orderBy: { signedAt: 'asc' },
    select: {
      id: true,
      context: true,
      signerName: true,
      signerType: true,
      signedAt: true,
      documentId: true,
      capturedBy: { select: { fullName: true } },
      approval: { select: { estimate: { select: { estimateNumber: true } } } },
    },
  });
}

export type JobSignature = Awaited<ReturnType<typeof listJobSignatures>>[number];
