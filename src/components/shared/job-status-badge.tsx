import { cn } from '@/lib/utils';
import type { JobCardStatus } from '@/generated/prisma/enums';
import { JOB_STATUS_LABEL } from '@/lib/workshop/stages';

// Status colors are semantic (success/warning/danger/info/neutral) and
// deliberately independent of the brand accent — violet is reserved for
// IN_PROGRESS, the one "work is actively happening" state.
const STATUS_CLASSES: Record<JobCardStatus, string> = {
  RECEIVED: 'bg-muted text-foreground/70',
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

export function JobStatusBadge({ status, className }: { status: JobCardStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 w-fit shrink-0 items-center rounded-full px-2.5 text-xs font-medium whitespace-nowrap',
        STATUS_CLASSES[status],
        className,
      )}
    >
      {JOB_STATUS_LABEL[status]}
    </span>
  );
}
