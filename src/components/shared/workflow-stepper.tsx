import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WORKFLOW_STAGES } from '@/lib/workshop/stages';
import type { JobCardStatus } from '@/generated/prisma/enums';

/** Horizontal progress stepper across the workflow stages (never ON_HOLD/CANCELLED — see getEffectiveStageStatus). */
export function WorkflowStepper({ effectiveStatus }: { effectiveStatus: JobCardStatus }) {
  const currentIndex = WORKFLOW_STAGES.findIndex((stage) => stage.status === effectiveStatus);

  return (
    <ol className="flex items-center">
      {WORKFLOW_STAGES.map((stage, index) => {
        const isDone = index < currentIndex;
        const isCurrent = index === currentIndex;
        return (
          <li key={stage.key} className="flex min-w-0 flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
                  isDone && 'border-primary bg-primary text-primary-foreground',
                  isCurrent && 'border-primary text-primary ring-4 ring-primary/15',
                  !isDone && !isCurrent && 'border-border text-muted-foreground',
                )}
              >
                {isDone ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span
                className={cn(
                  'text-center text-[11px] leading-tight text-balance',
                  isCurrent ? 'font-semibold text-foreground' : 'text-muted-foreground',
                )}
              >
                {stage.label}
              </span>
            </div>
            {index < WORKFLOW_STAGES.length - 1 ? (
              <div
                className={cn(
                  'mx-1.5 h-px flex-1 translate-y-[-9px]',
                  isDone ? 'bg-primary' : 'bg-border',
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
