'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, ClipboardList, ListChecks, Loader2, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { setJobCardStyleAction } from '@/app/(app)/settings/actions';
import { cn } from '@/lib/utils';

const STYLES: { detailed: boolean; icon: LucideIcon; title: string; description: string }[] = [
  {
    detailed: false,
    icon: ClipboardList,
    title: 'Minimal job card',
    description:
      'For a workshop where one person does everything. Take the vehicle in, bill it, take the payment, hand it back.',
  },
  {
    detailed: true,
    icon: ListChecks,
    title: 'Standard job card',
    description:
      'For a team. Adds technician assignment, inspection, diagnosis, customer approval, repair records and a quality check.',
  },
];

/**
 * Picks which job card every job card opens as. Saves on tap; the chosen
 * card shows a spinner while the app around it is redrawn.
 */
export function JobCardStyleForm({ detailed, canEdit }: { detailed: boolean; canEdit: boolean }) {
  const [current, setCurrent] = useState(detailed);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function choose(next: boolean) {
    if (next === current || !canEdit) return;
    setError(null);
    const previous = current;
    setCurrent(next);
    startTransition(async () => {
      // The action revalidates the layout; its response carries the redraw.
      const result = await setJobCardStyleAction(next);
      if (result.ok) {
        toast.success(next ? 'Standard job card turned on' : 'Minimal job card turned on');
      } else {
        setCurrent(previous);
        setError(result.error ?? 'Could not change the job card style.');
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Job card style" className="grid gap-3 sm:grid-cols-2">
        {STYLES.map((style) => {
          const selected = style.detailed === current;
          const Icon = style.icon;
          return (
            <button
              key={style.title}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-busy={(selected && isPending) || undefined}
              disabled={!canEdit || isPending}
              onClick={() => choose(style.detailed)}
              className={cn(
                'flex min-h-28 flex-col gap-2 rounded-xl border bg-card p-4 text-left transition-colors sm:p-5',
                selected ? 'border-primary ring-1 ring-primary' : 'border-border',
                canEdit && !selected && !isPending ? 'hover:bg-muted/50' : null,
                isPending ? 'cursor-wait' : null,
                !canEdit && !selected ? 'opacity-60' : null,
              )}
            >
              <span className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Icon className="size-4 text-muted-foreground" />
                  {style.title}
                </span>
                {selected && isPending ? (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Saving…
                  </span>
                ) : selected ? (
                  <CheckCircle2 className="size-5 text-primary" />
                ) : null}
              </span>
              <span className="text-sm text-muted-foreground">{style.description}</span>
            </button>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
