import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Active / Deleted, for lists whose records are archived rather than
 * destroyed. The deleted view is where a record is found to restore it.
 * Other lists with a second, rarer view (Received / Reversed payments) pass
 * their own labels and `show` value.
 */
export function ActiveDeletedTabs({
  basePath,
  deleted,
  query,
  labels = ['Active', 'Deleted'],
  show = 'deleted',
}: {
  basePath: string;
  deleted: boolean;
  query: string;
  labels?: [string, string];
  /** The ?show= value of the second view. */
  show?: string;
}) {
  const href = (showDeleted: boolean) => {
    const params = new URLSearchParams();
    if (showDeleted) params.set('show', show);
    if (query) params.set('q', query);
    return `${basePath}${params.size ? `?${params}` : ''}`;
  };
  const tab = (active: boolean) =>
    cn(
      'inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition-colors',
      active ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
    );
  return (
    <nav
      aria-label="Show"
      className="inline-flex self-start rounded-lg border border-border bg-muted/40 p-0.5"
    >
      <Link
        href={href(false)}
        aria-current={!deleted ? 'page' : undefined}
        className={tab(!deleted)}
      >
        {labels[0]}
      </Link>
      <Link href={href(true)} aria-current={deleted ? 'page' : undefined} className={tab(deleted)}>
        {labels[1]}
      </Link>
    </nav>
  );
}
