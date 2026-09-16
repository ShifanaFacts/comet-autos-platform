import type { JobCardStatus } from '@/generated/prisma/enums';

// Pure data/helpers only — no auth/session imports — so Client Components
// (e.g. job-cards/job-card-filters.tsx) can import this without pulling
// server-only code (next/headers via lib/auth/session.ts) into the client
// bundle. lib/workshop/job-status.ts re-exports these for server-side callers.

const EXCEPTION_STATUSES: JobCardStatus[] = ['ON_HOLD', 'CANCELLED'];

export interface WorkflowStage {
  key: string;
  label: string;
  status: JobCardStatus;
}

// The single source of truth for the "flow visual" (dashboard's Today's
// Workshop row and the Job Card page's WorkflowStepper) — the ordered,
// non-exception path through the coarse JobCardStatus enum (see the
// mapping note in job-status.ts). ON_HOLD/CANCELLED are exceptions, not
// stages, and are surfaced separately rather than as a step in this list.
export const WORKFLOW_STAGES: WorkflowStage[] = [
  { key: 'received', label: 'Received', status: 'RECEIVED' },
  { key: 'inspecting', label: 'Inspection', status: 'INSPECTING' },
  { key: 'diagnosed', label: 'Diagnosis', status: 'DIAGNOSED' },
  { key: 'estimate', label: 'Estimate', status: 'ESTIMATE_SENT' },
  { key: 'approved', label: 'Approved', status: 'APPROVED' },
  { key: 'repair', label: 'In Repair', status: 'IN_PROGRESS' },
  { key: 'completed', label: 'Completed', status: 'COMPLETED' },
  { key: 'invoiced', label: 'Invoiced', status: 'INVOICED' },
  { key: 'closed', label: 'Closed', status: 'CLOSED' },
];

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
