import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function QuickAction({
  href,
  icon: Icon,
  label,
  primary,
  comingIn,
}: {
  href?: string;
  icon: LucideIcon;
  label: string;
  primary?: boolean;
  /** e.g. "Phase 3" — renders as a disabled action with a phase badge instead of a link. */
  comingIn?: string;
}) {
  const content = (
    <>
      <Icon className="size-4 shrink-0" />
      <span>{label}</span>
      {comingIn ? (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {comingIn}
        </span>
      ) : null}
    </>
  );

  const classes = cn(
    'inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
    primary
      ? 'border-primary bg-primary text-primary-foreground shadow-sm shadow-primary/25 hover:bg-primary-hover'
      : 'border-border bg-card text-foreground shadow-xs hover:bg-muted',
    comingIn && 'pointer-events-none border-dashed bg-transparent text-muted-foreground shadow-none',
  );

  if (comingIn || !href) {
    return (
      <span className={classes} aria-disabled>
        {content}
      </span>
    );
  }

  return (
    <Link href={href} className={classes}>
      {content}
    </Link>
  );
}
