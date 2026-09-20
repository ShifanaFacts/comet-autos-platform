import type { JobCardStatus, MediaStage } from '@/generated/prisma/enums';
import { normalizeStatus } from '@/lib/workshop/stages';

/* Photo stages and their labels — free of database imports so screens can use them. */

export const MEDIA_STAGES: { stage: MediaStage; label: string }[] = [
  { stage: 'INTAKE', label: 'Intake' },
  { stage: 'INSPECTION', label: 'Inspection' },
  { stage: 'DIAGNOSIS', label: 'Diagnosis' },
  { stage: 'REPAIR', label: 'Repair' },
  { stage: 'QUALITY_CHECK', label: 'Quality check' },
  { stage: 'DELIVERY', label: 'Delivery' },
  { stage: 'GENERAL', label: 'General' },
];

export const MEDIA_STAGE_LABEL = Object.fromEntries(MEDIA_STAGES.map((s) => [s.stage, s.label])) as Record<MediaStage, string>;

/** The stage new photos most likely belong to, from where the job is now. */
export function defaultMediaStage(status: JobCardStatus): MediaStage {
  switch (normalizeStatus(status)) {
    case 'ARRIVED':
      return 'INTAKE';
    case 'INSPECTION':
      return 'INSPECTION';
    case 'DIAGNOSIS':
    case 'ESTIMATE':
    case 'WAITING_APPROVAL':
    case 'REJECTED':
    case 'APPROVED':
      return 'DIAGNOSIS';
    case 'REPAIR':
      return 'REPAIR';
    case 'QUALITY_CHECK':
      return 'QUALITY_CHECK';
    case 'READY':
    case 'INVOICED':
    case 'PAID':
    case 'DELIVERED':
      return 'DELIVERY';
    default:
      return 'GENERAL';
  }
}
