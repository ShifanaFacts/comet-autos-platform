import { cn } from '@/lib/utils';
import type { JobCardStatus } from '@/generated/prisma/enums';
import { JOB_STATUS_LABEL } from '@/lib/workshop/stages';
import { jobStatusTone, TONE_CLASSES } from '@/lib/workshop/status-tone';

/**
 * A job's status, the same everywhere: a dot and the plain-language label on
 * a soft background whose colour means something (see status-tone.ts). The
 * label always carries the meaning, so colour is never the only signal.
 */
export function JobStatusBadge({
  status,
  size = 'sm',
  className,
}: {
  status: JobCardStatus;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  const tone = TONE_CLASSES[jobStatusTone(status)];
  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full font-medium whitespace-nowrap',
        size === 'lg' ? 'h-8 px-3.5 text-sm' : 'h-6 px-2.5 text-xs',
        tone.badge,
        className,
      )}
    >
      <span
        className={cn('shrink-0 rounded-full', size === 'lg' ? 'size-2' : 'size-1.5', tone.dot)}
        aria-hidden
      />
      {JOB_STATUS_LABEL[status]}
    </span>
  );
}
