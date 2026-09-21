import type { JobCardStatus, MediaStage } from '@/generated/prisma/enums';
import { requireUser, hasPermission } from '@/lib/auth/authorize';
import { listJobPhotos } from '@/lib/media/photos';
import { formatDateTime } from '@/lib/format';
import { Panel } from '@/components/layout/primitives';
import { StagePhotos } from '@/components/media/stage-photos';

/**
 * Drops one stage's photos — and the camera to add to them — onto whatever
 * screen that stage's work happens on. Loads only that stage's rows, off
 * the (organization, job, stage) index; `requireUser` is request-cached, so
 * the page pays nothing extra for the session.
 */
export async function StagePhotosPanel({
  jobCardId,
  branchId,
  status,
  stage,
  hint,
}: {
  jobCardId: string;
  branchId: string | null;
  /** The job's status: photos can be added while the job is still live. */
  status: JobCardStatus;
  stage: MediaStage;
  hint?: string;
}) {
  const user = await requireUser();
  if (!hasPermission(user, 'job_card.view', { branchId: branchId ?? undefined })) return null;
  const photos = await listJobPhotos(user, jobCardId, { stage });
  // The same rule as the job card's own gallery: a photo may be added
  // until the vehicle has gone. The stage screen only decides which stage
  // it files under, never whether photographing is allowed.
  const isFinished = status === 'DELIVERED' || status === 'CANCELLED';
  const canEdit =
    !isFinished && hasPermission(user, 'job_card.edit', { branchId: branchId ?? undefined });
  if (!canEdit && photos.length === 0) return null;

  return (
    <Panel>
      <StagePhotos
        jobCardId={jobCardId}
        stage={stage}
        canEdit={canEdit}
        hint={hint}
        photos={photos.map((photo) => ({
          id: photo.id,
          stage: photo.stage,
          description: photo.description,
          createdAt: formatDateTime(photo.createdAt),
          uploadedBy: photo.uploadedBy?.fullName ?? 'Workshop',
        }))}
      />
    </Panel>
  );
}
