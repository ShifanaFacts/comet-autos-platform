import type { JobCardStatus } from '@/generated/prisma/enums';
import { normalizeStatus, type WorkflowStatus } from '@/lib/workshop/stages';

/*
 * What each job status MEANS, as one of five tones used everywhere a status
 * is shown (badges, the dashboard flow, the job card header):
 *
 *   neutral  — information only: queued, or finished and handed back
 *   info     — work is in progress in the workshop (blue)
 *   warning  — waiting on someone: the customer, a decision, payment (amber)
 *   success  — complete / settled (green)
 *   danger   — stopped or refused (red)
 *
 * The brand violet is kept for actions, never for status.
 */
export type StatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

export const JOB_STATUS_TONE: Record<WorkflowStatus, StatusTone> = {
  ARRIVED: 'neutral',
  INSPECTION: 'info',
  DIAGNOSIS: 'info',
  ESTIMATE: 'info',
  WAITING_APPROVAL: 'warning',
  APPROVED: 'warning',
  REJECTED: 'danger',
  REPAIR: 'info',
  QUALITY_CHECK: 'info',
  READY: 'success',
  INVOICED: 'warning',
  PAID: 'success',
  DELIVERED: 'neutral',
  ON_HOLD: 'warning',
  CANCELLED: 'danger',
};

export function jobStatusTone(status: JobCardStatus): StatusTone {
  return JOB_STATUS_TONE[normalizeStatus(status)];
}

/** Tailwind classes per tone: soft background, readable text, solid dot/bar. */
export const TONE_CLASSES: Record<StatusTone, { badge: string; dot: string; text: string }> = {
  neutral: {
    badge: 'bg-muted text-foreground/75',
    dot: 'bg-foreground/45',
    text: 'text-foreground',
  },
  info: { badge: 'bg-info/10 text-info', dot: 'bg-info', text: 'text-info' },
  warning: { badge: 'bg-warning/12 text-warning', dot: 'bg-warning', text: 'text-warning' },
  success: { badge: 'bg-success/10 text-success', dot: 'bg-success', text: 'text-success' },
  danger: { badge: 'bg-danger/10 text-danger', dot: 'bg-danger', text: 'text-danger' },
};
