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
      <Icon className={cn('size-4', primary && 'text-primary-foreground')} />
      <span>{label}</span>
      {comingIn ? (
        <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {comingIn}
        </span>
      ) : null}
    </>
  );

  const classes = cn(
    'flex items-center gap-2 rounded-md border px-3.5 py-2 text-sm font-medium transition-colors',
    primary
      ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
      : 'border-border bg-card hover:bg-muted',
    comingIn && 'pointer-events-none border-dashed text-muted-foreground opacity-70',
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
