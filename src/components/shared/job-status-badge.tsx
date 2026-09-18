import { cn } from '@/lib/utils';
import type { JobCardStatus } from '@/generated/prisma/enums';
import { JOB_STATUS_LABEL, normalizeStatus, type WorkflowStatus } from '@/lib/workshop/stages';

// Status colors are semantic (success/warning/danger/info/neutral) and
// deliberately independent of the brand accent — violet is reserved for
// REPAIR, the one "work is actively happening" state.
const STATUS_CLASSES: Record<WorkflowStatus, string> = {
  ARRIVED: 'bg-muted text-foreground/70',
  INSPECTION: 'bg-info/10 text-info',
  DIAGNOSIS: 'bg-info/10 text-info',
  ESTIMATE: 'bg-info/10 text-info',
  WAITING_APPROVAL: 'bg-warning/10 text-warning',
  APPROVED: 'bg-success/10 text-success',
  REJECTED: 'bg-danger/10 text-danger',
  REPAIR: 'bg-primary/10 text-primary',
  QUALITY_CHECK: 'bg-primary/10 text-primary',
  READY: 'bg-success/10 text-success',
  INVOICED: 'bg-success/10 text-success',
  PAID: 'bg-success/10 text-success',
  DELIVERED: 'bg-muted text-muted-foreground',
  ON_HOLD: 'bg-warning/10 text-warning',
  CANCELLED: 'bg-danger/10 text-danger',
};

export function JobStatusBadge({ status, className }: { status: JobCardStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 w-fit shrink-0 items-center rounded-full px-2.5 text-xs font-medium whitespace-nowrap',
        STATUS_CLASSES[normalizeStatus(status)],
        className,
      )}
    >
      {JOB_STATUS_LABEL[status]}
    </span>
  );
}
