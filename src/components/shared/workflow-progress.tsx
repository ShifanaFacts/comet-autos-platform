import { Check } from 'lucide-react';
import type { JobCardStatus } from '@/generated/prisma/enums';
import { WorkflowStepper } from '@/components/shared/workflow-stepper';
import { WORKFLOW_STAGES } from '@/lib/workshop/stages';

/**
 * Where the job is in the workshop journey. Desktop shows every stage; a
 * phone or narrow tablet shows a progress bar with the current and next
 * stage — the same information, sized for the screen, never a sideways
 * scroll.
 */
export function WorkflowProgress({ effectiveStatus }: { effectiveStatus: JobCardStatus }) {
  const index = Math.max(
    WORKFLOW_STAGES.findIndex((stage) => stage.status === effectiveStatus),
    0,
  );
  const current = WORKFLOW_STAGES[index];
  const next = WORKFLOW_STAGES[index + 1];
  const done = effectiveStatus === 'DELIVERED';
  const percent = Math.round(((index + (done ? 1 : 0.5)) / WORKFLOW_STAGES.length) * 100);

  return (
    <>
      <div className="hidden xl:block">
        <WorkflowStepper effectiveStatus={effectiveStatus} />
      </div>
      <div className="flex flex-col gap-2.5 xl:hidden">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="font-medium">
            {done ? (
              <span className="inline-flex items-center gap-1.5 text-success">
                <Check className="size-4" />
                Journey complete
              </span>
            ) : (
              <>
                Step {index + 1} of {WORKFLOW_STAGES.length} · {current.label}
              </>
            )}
          </span>
          {next && !done ? <span className="text-xs text-muted-foreground">Next: {next.label}</span> : null}
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="Workshop journey progress"
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
      </div>
    </>
  );
}
