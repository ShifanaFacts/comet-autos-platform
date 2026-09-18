import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// Section 22: never show a bare "No data" — always a friendly sentence and,
// where there's a real action, a way to take it.
//
// `boxed` (default) stands alone on a page; `inline` sits inside an existing
// surface or section without adding yet another border.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = 'boxed',
  tone = 'neutral',
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  variant?: 'boxed' | 'inline';
  tone?: 'neutral' | 'success';
}) {
  if (variant === 'inline') {
    return (
      <div className="flex items-start gap-3">
        {Icon ? (
          <span
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-full',
              tone === 'success' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
            )}
          >
            <Icon className="size-[18px]" />
          </span>
        ) : null}
        <div className="flex min-w-0 flex-col gap-1 pt-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          {action ? <div className="pt-3">{action}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center">
      {Icon ? (
        <span className="mb-2 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-5" />
        </span>
      ) : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="pt-4">{action}</div> : null}
    </div>
  );
}
