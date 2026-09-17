import { Skeleton } from '@/components/ui/skeleton';

export default function JobCardDetailLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <Skeleton className="mt-2 h-4 w-72" />
      </div>

      <div className="rounded-lg border border-border bg-card px-5 py-5">
        <div className="flex items-center">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="flex flex-1 items-center last:flex-none">
              <Skeleton className="size-6 shrink-0 rounded-full" />
              {i < 8 ? <Skeleton className="mx-1.5 h-px flex-1" /> : null}
            </div>
          ))}
        </div>
      </div>

      <Skeleton className="h-14 rounded-lg" />

      <div className="grid gap-3 md:grid-cols-2">
        <Skeleton className="h-32 rounded-lg" />
        <Skeleton className="h-32 rounded-lg" />
      </div>
    </div>
  );
}
