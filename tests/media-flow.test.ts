/**
 * Integration tests for job-card photos and optional signatures: what the
 * server accepts, who may see a file, and that a signature is recorded as a
 * business record — against the local database and the local disk storage
 * driver. Every run uses throwaway organizations and its own storage
 * directory, so real workshop data and files are never touched.
 *
 *   npm run test:integration
 */
import 'dotenv/config';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { prisma } from '@/lib/prisma';
import { AuthError } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { checkInVehicle } from '@/lib/workshop/check-in';
import { startInspection, saveInspection } from '@/lib/workshop/inspection';
import { saveDiagnosis } from '@/lib/workshop/diagnosis';
import {
  createEstimate,
  recordCustomerDecision,
  saveEstimateDraft,
  sendEstimate,
} from '@/lib/workshop/estimates';
import {
  MAX_PHOTOS_PER_UPLOAD,
  MAX_PHOTO_BYTES,
  authorizeJobMedia,
  listJobPhotos,
  listJobSignatures,
  readJobMedia,
  removeJobPhoto,
  uploadJobPhotos,
} from '@/lib/media/photos';
import { defaultMediaStage } from '@/lib/media/stages';
import { prepareSignature } from '@/lib/media/signatures';
import { getStorage } from '@/lib/storage';
import { createTestOrg, expectDomainError, RUN, type TestOrg } from './support';

// Files go to a throwaway directory for the run: the storage driver reads
// this the first time it is asked for a file, which is inside a test.
const STORAGE_DIR = mkdtempSync(path.join(tmpdir(), 'comet-media-test-'));
process.env.LOCAL_STORAGE_DIR = STORAGE_DIR;

/** The smallest valid files of each kind, by their real magic bytes. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(256, 2),
]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WEBP'),
  Buffer.alloc(64, 3),
]);
const NOT_AN_IMAGE = Buffer.from('This is a text file pretending to be a photo.');

let a: TestOrg;
let b: TestOrg;
let jobCardId: string;
let estimateId: string;
const plate = `M${RUN.slice(-4)} 21`;

before(async () => {
  a = await createTestOrg('MediaA');
  b = await createTestOrg('MediaB');
  ({ jobCardId } = await checkInVehicle(a.owner, {
    mode: 'new',
    customer: { name: 'Khalid Nasser', phone: '050 777 1234', email: '' },
    vehicle: { plateNumber: plate, make: 'Nissan', model: 'Patrol' },
    visit: { complaint: 'Brake noise', mileage: '81000' },
  }));
});

after(async () => {
  await prisma.$disconnect();
  rmSync(STORAGE_DIR, { recursive: true, force: true });
});

describe('job photos', () => {
  test('accepts real JPEG, PNG and WebP bytes, and records who, when and which stage', async () => {
    const documents = await uploadJobPhotos(
      a.owner,
      jobCardId,
      [
        { name: 'front.jpg', bytes: JPEG },
        { name: 'rear.png', bytes: PNG },
        { name: 'side.webp', bytes: WEBP },
      ],
      { stage: 'INTAKE', description: 'Condition on arrival' },
    );
    assert.equal(documents.length, 3);
    assert.deepEqual(
      documents.map((d) => d.mimeType),
      ['image/jpeg', 'image/png', 'image/webp'],
    );

    const photos = await listJobPhotos(a.owner, jobCardId);
    assert.equal(photos.length, 3);
    assert.ok(photos.every((photo) => photo.stage === 'INTAKE'));
    assert.equal(photos[0].uploadedBy?.fullName, a.owner.fullName);
    assert.equal(photos[0].description, 'Condition on arrival');
    // The list a screen renders never carries the storage key.
    assert.ok(!JSON.stringify(photos).includes('org/'), 'no storage key reaches the screen');

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: jobCardId, action: 'job_photo.uploaded' },
    });
    assert.ok(audit, 'the upload is in the audit log');
  });

  test('a file is checked by its bytes, not its name or the browser', async () => {
    await expectDomainError(
      uploadJobPhotos(a.owner, jobCardId, [{ name: 'notes.jpg', bytes: NOT_AN_IMAGE }], {
        stage: 'GENERAL',
      }),
      /isn’t a JPEG, PNG or WebP photo/,
    );
    await expectDomainError(
      uploadJobPhotos(a.owner, jobCardId, [{ name: 'empty.jpg', bytes: Buffer.alloc(0) }], {
        stage: 'GENERAL',
      }),
      /is empty/,
    );
  });

  test('size and count limits are enforced on the server', async () => {
    const tooBig = Buffer.concat([JPEG, Buffer.alloc(MAX_PHOTO_BYTES)]);
    await expectDomainError(
      uploadJobPhotos(a.owner, jobCardId, [{ name: 'huge.jpg', bytes: tooBig }], {
        stage: 'REPAIR',
      }),
      /larger than 10 MB/,
    );
    const many = Array.from({ length: MAX_PHOTOS_PER_UPLOAD + 1 }, (_, index) => ({
      name: `photo-${index}.jpg`,
      bytes: JPEG,
    }));
    await expectDomainError(
      uploadJobPhotos(a.owner, jobCardId, many, { stage: 'REPAIR' }),
      /up to 12 photos at a time/,
    );
    await expectDomainError(
      uploadJobPhotos(a.owner, jobCardId, [], { stage: 'REPAIR' }),
      /at least one photo/,
    );
  });

  test('a stage must be one the workshop uses, and it defaults from where the job is', async () => {
    await expectDomainError(
      uploadJobPhotos(a.owner, jobCardId, [{ name: 'x.jpg', bytes: JPEG }], { stage: 'INVOICING' }),
      /Choose which stage/,
    );
    assert.equal(defaultMediaStage('ARRIVED'), 'INTAKE');
    assert.equal(defaultMediaStage('REPAIR'), 'REPAIR');
    assert.equal(defaultMediaStage('DELIVERED'), 'DELIVERY');
  });

  test('adding a photo needs permission to work on the job', async () => {
    await assert.rejects(
      uploadJobPhotos(a.viewer, jobCardId, [{ name: 'x.jpg', bytes: JPEG }], { stage: 'GENERAL' }),
      (error: unknown) => error instanceof AuthError,
    );
    // A viewer may still see them.
    const photos = await listJobPhotos(a.viewer, jobCardId);
    assert.ok(photos.length > 0);
  });

  test('another organization can neither list nor read the files', async () => {
    await assert.rejects(
      listJobPhotos(b.owner, jobCardId),
      (error: unknown) => error instanceof NotFoundError,
    );
    const [photo] = await listJobPhotos(a.owner, jobCardId);
    await assert.rejects(
      readJobMedia(b.owner, photo.id),
      (error: unknown) => error instanceof NotFoundError,
      'another org gets "not found", never the file',
    );
    const file = await readJobMedia(a.owner, photo.id);
    assert.ok(file.bytes.length > 0);
    assert.equal(file.mimeType, 'image/jpeg');
  });

  test('removing a photo keeps the record, marks who removed it, and stops serving it', async () => {
    const before = await listJobPhotos(a.owner, jobCardId);
    const target = before[before.length - 1];
    await removeJobPhoto(a.owner, jobCardId, target.id, { reason: 'Blurred' });

    const after = await listJobPhotos(a.owner, jobCardId);
    assert.equal(after.length, before.length - 1);
    const row = await prisma.document.findUniqueOrThrow({ where: { id: target.id } });
    assert.ok(row.deletedAt, 'the record is kept, marked removed');
    assert.equal(row.deletedByUserId, a.owner.id);
    assert.ok(await getStorage().get(row.storageKey), 'the file itself is not destroyed');
    await assert.rejects(
      readJobMedia(a.owner, target.id),
      (error: unknown) => error instanceof NotFoundError,
      'a removed photo is no longer served',
    );
    assert.ok(
      await prisma.auditLog.findFirst({
        where: { entityId: target.id, action: 'job_photo.removed' },
      }),
    );
  });

  test('a photo can only be removed through the job it belongs to', async () => {
    // A second job in the same organization and branch: the remover has
    // every right on both, so only the job scoping can refuse this.
    const { jobCardId: otherJobId } = await checkInVehicle(a.owner, {
      mode: 'new',
      customer: { name: 'Other Owner', phone: '050 321 9876', email: '' },
      vehicle: { plateNumber: `X${RUN.slice(-4)} 44`, make: 'Kia', model: 'Seltos' },
      visit: { complaint: 'Service', mileage: '12000' },
    });
    const [photo] = await listJobPhotos(a.owner, jobCardId);

    await assert.rejects(
      removeJobPhoto(a.owner, otherJobId, photo.id),
      (error: unknown) => error instanceof NotFoundError,
      'a document id from one job cannot be acted on from another',
    );
    const row = await prisma.document.findUniqueOrThrow({ where: { id: photo.id } });
    assert.equal(row.deletedAt, null, 'and the photo is untouched');
  });

  test('a stage screen sees only its own stage', async () => {
    await uploadJobPhotos(a.owner, jobCardId, [{ name: 'qc.jpg', bytes: JPEG }], {
      stage: 'QUALITY_CHECK',
      requestKey: `media-stage-filter-key-${RUN}`,
    });
    const qc = await listJobPhotos(a.owner, jobCardId, { stage: 'QUALITY_CHECK' });
    assert.ok(qc.length > 0);
    assert.ok(
      qc.every((photo) => photo.stage === 'QUALITY_CHECK'),
      'nothing from another stage leaks in',
    );
    const all = await listJobPhotos(a.owner, jobCardId);
    assert.ok(all.length > qc.length, 'and the unfiltered list is still the whole job');
  });

  test('serving a file needs the right to see the job, checked before the bytes', async () => {
    const [photo] = await listJobPhotos(a.owner, jobCardId);
    // Someone with no job-card rights at all: authorization is refused
    // before storage is ever asked for the file.
    const stranger = { ...a.owner, orgWidePermissions: new Set<string>(), branchPermissions: new Map() };
    await assert.rejects(
      authorizeJobMedia(stranger as typeof a.owner, photo.id),
      (error: unknown) => error instanceof AuthError,
    );
    await assert.rejects(
      readJobMedia(stranger as typeof a.owner, photo.id),
      (error: unknown) => error instanceof AuthError,
    );
    // An unknown id is "not found", never a hint that something is there.
    await assert.rejects(
      authorizeJobMedia(a.owner, '00000000-0000-7000-8000-000000000000'),
      (error: unknown) => error instanceof NotFoundError,
    );
  });

  test('the same submission twice adds the photos once', async () => {
    const input = { stage: 'INSPECTION' as const, requestKey: `media-duplicate-key-${RUN}` };
    const files = [{ name: 'dup.jpg', bytes: JPEG }];
    const before = (await listJobPhotos(a.owner, jobCardId)).length;
    const results = await Promise.allSettled([
      uploadJobPhotos(a.owner, jobCardId, files, input),
      uploadJobPhotos(a.owner, jobCardId, files, input),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await listJobPhotos(a.owner, jobCardId)).length, before + 1);
  });
});

describe('signatures', () => {
  test('a signature must be a real PNG, and stays optional', async () => {
    assert.equal(await prepareSignature(null, a.organizationId, jobCardId), null);
    assert.equal(await prepareSignature('', a.organizationId, jobCardId), null);
    await expectDomainError(
      prepareSignature('data:image/png;base64,bm90LWEtcG5n', a.organizationId, jobCardId),
      /signature/i,
    );
    const prepared = await prepareSignature(
      `data:image/png;base64,${PNG.toString('base64')}`,
      a.organizationId,
      jobCardId,
    );
    assert.ok(prepared, 'a real PNG data URL is accepted');
  });

  test('an in-person approval can carry the customer signature — and works without one', async () => {
    const inspection = await startInspection(a.owner, jobCardId, a.technicianIds[0]);
    await saveInspection(
      a.owner,
      inspection.id,
      { items: [{ description: 'Brakes', result: 'FAILED', notes: 'Pads worn' }] },
      { complete: true },
    );
    await saveDiagnosis(a.owner, jobCardId, {
      findings: 'Front pads below limit',
      recommendedAction: 'Replace front pads',
      employeeId: a.technicianIds[0],
    });
    const estimate = await createEstimate(a.owner, jobCardId);
    estimateId = estimate.id;
    await saveEstimateDraft(a.owner, estimateId, {
      validUntil: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
      items: [
        {
          itemType: 'LABOUR',
          description: 'Replace front pads',
          quantity: '2',
          unitPrice: '150.00',
          taxRate: '5',
        },
      ],
    });
    await sendEstimate(a.owner, estimateId);

    await recordCustomerDecision(a.owner, estimateId, {
      decision: 'APPROVED',
      method: 'IN_PERSON',
      notes: 'Signed at the counter',
      signature: `data:image/png;base64,${PNG.toString('base64')}`,
      signerName: 'Khalid Nasser',
    });

    const signatures = await listJobSignatures(a.owner, jobCardId);
    assert.equal(signatures.length, 1);
    const [signature] = signatures;
    assert.equal(signature.context, 'QUOTATION_APPROVAL');
    assert.equal(signature.signerType, 'CUSTOMER');
    assert.equal(signature.signerName, 'Khalid Nasser');
    assert.equal(signature.capturedBy?.fullName, a.owner.fullName);
    assert.ok(signature.approval?.estimate.estimateNumber, 'it points at what was approved');
    assert.ok(
      await prisma.auditLog.findFirst({ where: { action: 'signature.captured' } }),
      'capturing a signature is audited',
    );

    // The image is served only through the permission-checked route, by document id.
    const file = await readJobMedia(a.owner, signature.documentId);
    assert.equal(file.mimeType, 'image/png');
    await assert.rejects(
      readJobMedia(b.owner, signature.documentId),
      (error: unknown) => error instanceof NotFoundError,
    );
  });

  test('a decision recorded without a signature is still a decision', async () => {
    const other = await createTestOrg('MediaC');
    const { jobCardId: second } = await checkInVehicle(other.owner, {
      mode: 'new',
      customer: { name: 'Sara Ali', phone: '055 222 3344', email: '' },
      vehicle: { plateNumber: `N${RUN.slice(-4)} 44`, make: 'Toyota', model: 'Corolla' },
      visit: { complaint: 'Service', mileage: '30000' },
    });
    const inspection = await startInspection(other.owner, second, other.technicianIds[0]);
    await saveInspection(
      other.owner,
      inspection.id,
      { items: [{ description: 'Oil', result: 'ATTENTION_NEEDED', notes: 'Due' }] },
      { complete: true },
    );
    await saveDiagnosis(other.owner, second, {
      findings: 'Service due',
      recommendedAction: 'Full service',
      employeeId: other.technicianIds[0],
    });
    const estimate = await createEstimate(other.owner, second);
    await saveEstimateDraft(other.owner, estimate.id, {
      validUntil: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
      items: [
        {
          itemType: 'LABOUR',
          description: 'Full service',
          quantity: '1',
          unitPrice: '300.00',
          taxRate: '5',
        },
      ],
    });
    await sendEstimate(other.owner, estimate.id);
    const approval = await recordCustomerDecision(other.owner, estimate.id, {
      decision: 'APPROVED',
      method: 'PHONE',
      notes: 'Approved by phone',
    });
    assert.equal(approval.status, 'APPROVED');
    assert.deepEqual(await listJobSignatures(other.owner, second), []);
  });
});
