import { Panel, Stack } from '@/components/layout/primitives';
import { Skeleton } from '@/components/ui/skeleton';

export default function JobCardsLoading() {
  return (
    <Stack gap="2xl">
      <div className="flex flex-col gap-6 border-b border-border pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-10 w-44 rounded-lg" />
      </div>

      <Stack gap="base">
        <div className="flex flex-wrap gap-3">
          <Skeleton className="h-9 w-full rounded-lg sm:w-96" />
          <Skeleton className="h-9 w-36 rounded-lg" />
        </div>

        <Panel padding="none" className="overflow-hidden">
          <div className="flex h-11 items-center gap-8 border-b border-border bg-muted/40 px-6">
            {['Job #', 'Vehicle', 'Customer', 'Status', 'Opened'].map((label) => (
              <Skeleton key={label} className="h-3 w-16" />
            ))}
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-8 border-b border-border px-6 py-4 last:border-0">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </Panel>
      </Stack>
    </Stack>
  );
}
