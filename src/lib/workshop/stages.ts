import type { JobCardStatus } from '@/generated/prisma/enums';

// Pure data/helpers only — no auth/session imports — so Client Components
// can import this without pulling server-only code into the client bundle.
// lib/workshop/job-status.ts re-exports these for server-side callers.

const EXCEPTION_STATUSES: JobCardStatus[] = ['ON_HOLD', 'CANCELLED'];

export interface WorkflowStage {
  key: string;
  label: string;
  status: JobCardStatus;
}

/**
 * The ordered, non-exception path through the frozen JobCardStatus enum.
 *
 * Labels follow the workshop's vocabulary, not the enum names: the enum value
 * RECEIVED is shown as "Arrived" everywhere in the UI. The frozen schema has
 * no ARRIVED value, and adding one would be a schema change — see
 * PROJECT-STATUS.md "Decisions awaiting approval".
 */
export const WORKFLOW_STAGES: WorkflowStage[] = [
  { key: 'received', label: 'Arrived', status: 'RECEIVED' },
  { key: 'inspecting', label: 'Inspection', status: 'INSPECTING' },
  { key: 'diagnosed', label: 'Diagnosis', status: 'DIAGNOSED' },
  { key: 'estimate', label: 'Estimate', status: 'ESTIMATE_SENT' },
  { key: 'approved', label: 'Approved', status: 'APPROVED' },
  { key: 'repair', label: 'In Repair', status: 'IN_PROGRESS' },
  { key: 'completed', label: 'Completed', status: 'COMPLETED' },
  { key: 'invoiced', label: 'Invoiced', status: 'INVOICED' },
  { key: 'closed', label: 'Closed', status: 'CLOSED' },
];

export const JOB_STATUS_LABEL: Record<JobCardStatus, string> = {
  RECEIVED: 'Arrived',
  INSPECTING: 'In inspection',
  DIAGNOSED: 'Diagnosed',
  ESTIMATE_SENT: 'Waiting approval',
  APPROVED: 'Approved',
  IN_PROGRESS: 'In repair',
  ON_HOLD: 'On hold',
  COMPLETED: 'Completed',
  INVOICED: 'Invoiced',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

/**
 * The stage a job "is at" for the stepper, even while ON_HOLD/CANCELLED —
 * those don't have their own stepper position, so this walks the status
 * history (most-recent first) to find the last real stage it was in.
 */
export function getEffectiveStageStatus(
  currentStatus: JobCardStatus,
  history: { toStatus: JobCardStatus }[],
): JobCardStatus {
  if (!EXCEPTION_STATUSES.includes(currentStatus)) return currentStatus;
  const lastRealStage = history.find((entry) => !EXCEPTION_STATUSES.includes(entry.toStatus));
  return lastRealStage?.toStatus ?? 'RECEIVED';
}
