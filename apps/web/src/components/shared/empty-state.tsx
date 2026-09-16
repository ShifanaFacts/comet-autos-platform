import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

// Section 22: never show a bare "No data" — always a friendly sentence and,
// where there's a real action, a way to take it.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center">
      {Icon ? <Icon className="size-5 text-muted-foreground/60" /> : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
