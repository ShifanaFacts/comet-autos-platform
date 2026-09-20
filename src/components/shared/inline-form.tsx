'use client';

import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A form that lives at the foot of a panel but stays folded until it is
 * needed. The job card would otherwise show four empty forms at once, which
 * buries the record of work that was actually done. Nothing is removed —
 * every field is one tap away.
 *
 * Give `defaultOpen` to the form that *is* the job's next action.
 *
 * This is a button and a conditional panel rather than a native <details>:
 * React treats `<details open={…}>` as controlled and fights the browser's
 * own toggling, which silently closed the panel mid-edit and took the
 * half-typed form with it.
 */
export function InlineForm({
  label,
  hint,
  icon,
  defaultOpen = false,
  tone = 'default',
  variant = 'foot',
  children,
}: {
  label: string;
  hint?: string;
  /** A rendered icon element — a component function cannot cross the server boundary. */
  icon?: ReactNode;
  defaultOpen?: boolean;
  /** `primary` for the step the job is waiting on. */
  tone?: 'default' | 'primary';
  /** `foot` sits flush at the bottom of a panel; `inset` is a block inside a padded one. */
  variant?: 'foot' | 'inset';
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const inset = variant === 'inset';

  return (
    <div
      className={cn(
        'group',
        inset ? 'overflow-hidden rounded-lg border border-border' : 'border-t border-border',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex w-full cursor-pointer items-center gap-3 py-4 text-sm font-medium transition-colors outline-none select-none',
          inset ? 'px-4' : 'px-4 sm:px-6',
          'hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset',
          tone === 'primary' ? 'text-primary' : 'text-foreground',
        )}
      >
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-full transition-colors',
            tone === 'primary'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground group-hover:bg-background',
          )}
        >
          {icon ?? <Plus className="size-4" />}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5 text-left">
          {label}
          {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
        </span>
        <ChevronDown
          className={cn(
            'ml-auto size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      <div
        id={panelId}
        hidden={!open}
        className={cn('border-t border-border bg-muted/25 py-6', inset ? 'px-4' : 'px-4 sm:px-6')}
      >
        {children}
      </div>
    </div>
  );
}
