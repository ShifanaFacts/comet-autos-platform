import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FlowStage {
  key: string;
  label: string;
  count: number;
}

// Ties each workflow stage to what it means for the business, using the
// brand's semantic palette intentionally (violet = core commercial
// checkpoints, blue = under assessment, amber = active work, green = done) —
// per the design system's "violet for workflow progress" rule, rather than
// an arbitrary gradient.
const STAGE_TONE: Record<string, { bar: string; bg: string; text: string }> = {
  received: { bar: 'bg-foreground/30', bg: 'bg-secondary', text: 'text-foreground' },
  inspecting: { bar: 'bg-info', bg: 'bg-info/10', text: 'text-info' },
  diagnosed: { bar: 'bg-info', bg: 'bg-info/10', text: 'text-info' },
  estimate: { bar: 'bg-primary', bg: 'bg-primary/10', text: 'text-primary' },
  approved: { bar: 'bg-primary', bg: 'bg-primary/10', text: 'text-primary' },
  repair: { bar: 'bg-warning', bg: 'bg-warning/10', text: 'text-warning' },
  completed: { bar: 'bg-success', bg: 'bg-success/10', text: 'text-success' },
  invoiced: { bar: 'bg-primary', bg: 'bg-primary/10', text: 'text-primary' },
  closed: { bar: 'bg-foreground/30', bg: 'bg-secondary', text: 'text-foreground' },
};

/** Dashboard's "Today's Workshop" strip: BOOKED → ARRIVED → ... as stage chips with live counts. */
export function WorkshopFlowRow({ stages }: { stages: FlowStage[] }) {
  return (
    <div className="flex items-stretch gap-1.5 overflow-x-auto pb-1">
      {stages.map((stage, index) => {
        const tone = STAGE_TONE[stage.key];
        const active = stage.count > 0;
        return (
          <div key={stage.key} className="flex items-center">
            <div
              className={cn(
                'relative flex min-w-[96px] flex-col items-center gap-0.5 overflow-hidden rounded-lg border px-3 py-2.5 text-center transition-colors',
                active ? cn(tone.bg, 'border-transparent shadow-sm') : 'border-border/60 bg-card',
              )}
            >
              <span className={cn('absolute inset-x-0 top-0 h-0.5', active ? tone.bar : 'bg-transparent')} />
              <span className={cn('text-xl font-semibold tabular-nums', active ? tone.text : 'text-foreground')}>
                {stage.count}
              </span>
              <span className="text-[11px] whitespace-nowrap text-muted-foreground">{stage.label}</span>
            </div>
            {index < stages.length - 1 ? (
              <ChevronRight className="size-4 shrink-0 text-border" aria-hidden />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
