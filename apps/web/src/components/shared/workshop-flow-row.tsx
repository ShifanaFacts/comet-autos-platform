import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FlowStage {
  key: string;
  label: string;
  count: number;
}

/** Dashboard's "Today's Workshop" strip: BOOKED → ARRIVED → ... as stage chips with live counts. */
export function WorkshopFlowRow({ stages }: { stages: FlowStage[] }) {
  return (
    <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
      {stages.map((stage, index) => (
        <div key={stage.key} className="flex items-center">
          <div
            className={cn(
              'flex min-w-[92px] flex-col items-center gap-0.5 rounded-md px-3 py-2 text-center',
              stage.count > 0 ? 'bg-secondary' : '',
            )}
          >
            <span className="text-xl font-semibold tabular-nums">{stage.count}</span>
            <span className="text-[11px] whitespace-nowrap text-muted-foreground">{stage.label}</span>
          </div>
          {index < stages.length - 1 ? (
            <ChevronRight className="size-4 shrink-0 text-border" aria-hidden />
          ) : null}
        </div>
      ))}
    </div>
  );
}
