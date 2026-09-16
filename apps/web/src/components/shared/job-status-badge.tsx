import { Badge } from '@/components/ui/badge';
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

const STATUS_VARIANT: Record<JobCardStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  RECEIVED: 'secondary',
  INSPECTING: 'secondary',
  DIAGNOSED: 'secondary',
  ESTIMATE_SENT: 'outline',
  APPROVED: 'outline',
  IN_PROGRESS: 'default',
  ON_HOLD: 'destructive',
  COMPLETED: 'default',
  INVOICED: 'default',
  CLOSED: 'secondary',
  CANCELLED: 'destructive',
};

export function JobStatusBadge({ status }: { status: JobCardStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}
