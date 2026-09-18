import type { JobCardStatus } from '@/generated/prisma/enums';
import { JOB_STATUS_LABEL } from '@/lib/workshop/stages';
import { formatDateTime } from '@/lib/format';

interface TimelineEntry {
  id: string;
  toStatus: JobCardStatus;
  fromStatus: JobCardStatus | null;
  changedAt: Date;
  changedBy: { fullName: string };
}

export function StatusTimeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ol className="flex flex-col">
      {entries.map((entry, index) => (
        <li key={entry.id} className="relative flex gap-3">
          <div className="flex flex-col items-center">
            <span className={index === 0 ? 'mt-1.5 size-2.5 shrink-0 rounded-full bg-primary' : 'mt-1.5 size-2.5 shrink-0 rounded-full bg-border'} />
            {index < entries.length - 1 ? <span className="my-1 w-px flex-1 bg-border" /> : null}
          </div>
          <div className="flex min-w-0 flex-col gap-0.5 pb-4">
            <p className="text-sm font-medium">
              {entry.fromStatus ? JOB_STATUS_LABEL[entry.toStatus] : `Checked in · ${JOB_STATUS_LABEL[entry.toStatus]}`}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(entry.changedAt)} · {entry.changedBy.fullName}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
