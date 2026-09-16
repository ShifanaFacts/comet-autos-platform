import { cn } from '@/lib/utils';
import type { JobCardStatus } from '@/generated/prisma/enums';

const STATUS_LABEL: Record<JobCardStatus, string> = {
  RECEIVED: 'Received',
  INSPECTING: 'Inspecting',
  DIAGNOSED: 'Diagnosed',
  ESTIMATE_SENT: 'Estimate sent',
  APPROVED: 'Approved',
  IN_PROGRESS: 'In progress',
  ON_HOLD: 'On hold',
  COMPLETED: 'Completed',
  INVOICED: 'Invoiced',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

// Status colors are semantic (success/warning/danger/info/neutral) and
// deliberately independent of the brand accent — the brand violet is
// reserved for IN_PROGRESS, the one "work is actively happening" state,
// matching its role elsewhere as the "active/brand" highlight color.
const STATUS_CLASSES: Record<JobCardStatus, string> = {
  RECEIVED: 'bg-muted text-muted-foreground',
  INSPECTING: 'bg-info/10 text-info',
  DIAGNOSED: 'bg-info/10 text-info',
  ESTIMATE_SENT: 'bg-warning/10 text-warning',
  APPROVED: 'bg-success/10 text-success',
  IN_PROGRESS: 'bg-primary/10 text-primary',
  ON_HOLD: 'bg-warning/10 text-warning',
  COMPLETED: 'bg-success/10 text-success',
  INVOICED: 'bg-success/10 text-success',
  CLOSED: 'bg-muted text-muted-foreground',
  CANCELLED: 'bg-danger/10 text-danger',
};

export function JobStatusBadge({ status }: { status: JobCardStatus }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 w-fit shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        STATUS_CLASSES[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
