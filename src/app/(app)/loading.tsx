import { Panel, Stack } from '@/components/layout/primitives';
import { Skeleton } from '@/components/ui/skeleton';

// Generic route-level loading state (section 23): a shape-matched skeleton
// rather than a full-screen spinner, shown by Next.js while a page's async
// Server Component data is being fetched. Mirrors the PageHeader + section
// rhythm every page shares.
export default function AppLoading() {
  return (
    <Stack gap="2xl">
      <div className="flex flex-col gap-6 border-b border-border pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-10 w-44 rounded-lg" />
      </div>
      <Panel padding="none" className="grid grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-3 p-4 sm:p-6">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-12" />
          </div>
        ))}
      </Panel>
      <div className="grid gap-8 xl:grid-cols-12">
        <Skeleton className="h-72 rounded-xl xl:col-span-8" />
        <Skeleton className="h-40 rounded-xl xl:col-span-4" />
      </div>
    </Stack>
  );
}
