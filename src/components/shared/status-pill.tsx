import { cn } from '@/lib/utils';

export type PillTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'primary';

const TONE: Record<PillTone, string> = {
  neutral: 'bg-muted text-foreground/70',
  info: 'bg-info/10 text-info',
  warning: 'bg-warning/10 text-warning',
  success: 'bg-success/10 text-success',
  danger: 'bg-danger/10 text-danger',
  primary: 'bg-primary/10 text-primary',
};

/** Small semantic status chip for appointments, estimates and inspections. */
export function StatusPill({ tone, children, className }: { tone: PillTone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 w-fit shrink-0 items-center rounded-full px-2.5 text-xs font-medium whitespace-nowrap',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
