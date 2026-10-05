import Link from 'next/link';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

/*
 * The overviews' building blocks: a figure with how it moved since the
 * period before, and a row of them. One surface per row, so the eye compares
 * numbers rather than boxes; sized by the row's own width, so four across on
 * a desk, two on a tablet, one on a phone.
 */

export function KpiRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    // The 1px gaps over a border-coloured backing are the dividers, at any width.
    <div
      className={cn(
        '@container overflow-hidden rounded-2xl border border-border bg-border shadow-card',
        className,
      )}
    >
      <div className="grid gap-px @md:grid-cols-2 @4xl:grid-cols-4 [&>*]:bg-card">{children}</div>
    </div>
  );
}

export function Kpi({
  label,
  value,
  hint,
  change,
  compareLabel,
  /** Costs: a rise is bad news, so it shows in red. */
  lowerIsBetter = false,
  href,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string | null;
  /** Percent change from the period before; null when there is nothing to compare. */
  change?: number | null;
  compareLabel?: string;
  lowerIsBetter?: boolean;
  href?: string;
  tone?: 'default' | 'good' | 'bad';
}) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        {label}
        {href ? (
          <ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
        ) : null}
      </span>
      <span
        className={cn(
          'text-2xl leading-tight font-semibold tracking-[-0.02em] tabular-nums sm:text-[26px]',
          tone === 'good' && 'text-success',
          tone === 'bad' && 'text-danger',
        )}
      >
        {value}
      </span>
      {change !== undefined ? (
        <Change change={change} label={compareLabel} lowerIsBetter={lowerIsBetter} />
      ) : null}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </>
  );
  const className = 'flex min-w-0 flex-col gap-1.5 p-4 sm:p-5';
  return href ? (
    <Link href={href} className={cn('group transition-colors hover:bg-muted/40', className)}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** "▲ 12.5% vs the same days last month" — green when it moved the good way. */
export function Change({
  change,
  label,
  lowerIsBetter = false,
}: {
  change: number | null;
  label?: string;
  lowerIsBetter?: boolean;
}) {
  if (change === null) {
    return (
      <span className="text-xs text-muted-foreground">
        {label ? `Nothing to compare ${label.replace(/^vs /, 'with ')}` : 'No earlier figure'}
      </span>
    );
  }
  const flat = change === 0;
  const up = change > 0;
  const good = flat ? null : up !== lowerIsBetter;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 text-xs">
      <span
        className={cn(
          'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium tabular-nums',
          good === null && 'bg-muted text-muted-foreground',
          good === true && 'bg-success/12 text-success',
          good === false && 'bg-danger/10 text-danger',
        )}
      >
        <Icon className="size-3" />
        {Math.abs(change).toLocaleString('en-AE', { maximumFractionDigits: 1 })}%
      </span>
      {label ? <span className="text-muted-foreground">{label}</span> : null}
    </span>
  );
}

/** A labelled count that links to the list behind it — for "needs attention". */
export function AttentionChip({
  href,
  count,
  label,
  tone = 'default',
}: {
  href: string;
  count: string | number;
  label: string;
  tone?: 'default' | 'warning' | 'danger';
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex min-h-10 items-center gap-2 rounded-full border bg-card px-3.5 text-sm transition-colors hover:bg-muted',
        tone === 'danger'
          ? 'border-danger/40'
          : tone === 'warning'
            ? 'border-warning/40'
            : 'border-border',
      )}
    >
      <span
        className={cn(
          'font-semibold tabular-nums',
          tone === 'danger' && 'text-danger',
          tone === 'warning' && 'text-warning',
        )}
      >
        {count}
      </span>
      <span className="text-muted-foreground">{label}</span>
    </Link>
  );
}
