import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface FlowStage {
  key: string;
  label: string;
  status: string;
  count: number;
}

// Ties each workflow stage to what it means for the business, using the
// brand's semantic palette intentionally (violet = core commercial
// checkpoints, blue = under assessment, amber = active work, green = done) —
// per the design system's "violet for workflow progress" rule, rather than
// an arbitrary gradient.
const STAGE_TONE: Record<string, { bar: string; text: string }> = {
  arrived: { bar: 'bg-foreground/40', text: 'text-foreground' },
  inspection: { bar: 'bg-info', text: 'text-info' },
  diagnosis: { bar: 'bg-info', text: 'text-info' },
  estimate: { bar: 'bg-primary', text: 'text-primary' },
  waiting: { bar: 'bg-warning', text: 'text-warning' },
  approved: { bar: 'bg-primary', text: 'text-primary' },
  repair: { bar: 'bg-warning', text: 'text-warning' },
  qc: { bar: 'bg-warning', text: 'text-warning' },
  ready: { bar: 'bg-success', text: 'text-success' },
  invoiced: { bar: 'bg-primary', text: 'text-primary' },
  paid: { bar: 'bg-success', text: 'text-success' },
  delivered: { bar: 'bg-foreground/40', text: 'text-foreground' },
};

/**
 * The workshop pipeline: one column per workflow stage, each with a live
 * count and a progress rule. Laid out as an even grid (not a row of cards)
 * so it reads as a single continuous process across the available width.
 */
export function WorkshopFlowRow({ stages }: { stages: FlowStage[] }) {
  return (
    <ol className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 lg:grid-cols-6">
      {stages.map((stage) => {
        const tone = STAGE_TONE[stage.key];
        const active = stage.count > 0;
        return (
          <li key={stage.key} className="min-w-0">
            <Link
              href={`/job-cards?status=${stage.status}`}
              className="group flex flex-col gap-3 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span
                className={cn('h-1 rounded-full', active ? tone.bar : 'bg-border')}
                aria-hidden
              />
              <span className="flex flex-col gap-1">
                <span
                  className={cn(
                    'text-2xl leading-none font-semibold tabular-nums',
                    active ? tone.text : 'text-foreground/25',
                  )}
                >
                  {stage.count}
                </span>
                <span
                  className="truncate text-xs text-muted-foreground group-hover:text-foreground"
                  title={stage.label}
                >
                  {stage.label}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
