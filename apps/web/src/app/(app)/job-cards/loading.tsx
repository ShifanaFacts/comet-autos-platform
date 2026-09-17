import { Skeleton } from '@/components/ui/skeleton';

export default function JobCardsLoading() {
  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="mt-2 h-4 w-24" />
        </div>
        <Skeleton className="h-8 w-36 rounded-md" />
      </div>

      <div className="mb-4 flex gap-2">
        <Skeleton className="h-9 w-72 rounded-md" />
        <Skeleton className="h-9 w-36 rounded-md" />
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="flex gap-4 border-b border-border bg-muted/40 px-4 py-2.5">
          {['Job #', 'Vehicle', 'Customer', 'Status', 'Opened'].map((label) => (
            <Skeleton key={label} className="h-3 w-16" />
          ))}
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-6 border-b border-border px-4 py-3 last:border-0">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-4 w-32" />
          </div>
        ))}
      </div>
    </div>
  );
}
