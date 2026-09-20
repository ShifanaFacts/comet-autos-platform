import { cn } from '@/lib/utils';

export type PillTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'primary';

const TONE: Record<PillTone, string> = {
  neutral: 'bg-muted text-foreground/70 ring-foreground/10',
  info: 'bg-info/10 text-info ring-info/20',
  warning: 'bg-warning/10 text-warning ring-warning/20',
  success: 'bg-success/10 text-success ring-success/20',
  danger: 'bg-danger/10 text-danger ring-danger/20',
  primary: 'bg-primary/10 text-primary ring-primary/20',
};

/** Small semantic status chip for appointments, estimates and inspections. */
export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: PillTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-[26px] w-fit shrink-0 items-center rounded-full px-2.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
