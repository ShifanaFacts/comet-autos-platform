import { Panel, Stack } from '@/components/layout/primitives';
import { Skeleton } from '@/components/ui/skeleton';

export default function UsersLoading() {
  return (
    <Stack gap="2xl">
      <div className="flex flex-col gap-6 border-b border-border pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-11 w-32 rounded-lg" />
      </div>

      <Skeleton className="h-[52px] w-full rounded-xl" />
      <Skeleton className="h-12 w-full rounded-xl" />
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-11 w-56 rounded-xl" />
        <Skeleton className="h-11 w-36 rounded-lg" />
      </div>

      {/* Phone: the same rows the list shows. Desktop: the table. */}
      <div className="flex flex-col gap-2 lg:hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
      <Panel padding="none" className="hidden overflow-hidden lg:block">
        <div className="flex h-12 items-center gap-8 border-b border-border bg-muted/40 px-6">
          {['Name', 'Employee', 'Contact', 'Roles', 'Branch', 'Last signed in', 'Status'].map(
            (label) => (
              <Skeleton key={label} className="h-3 w-16" />
            ),
          )}
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-8 border-b border-border px-6 py-4 last:border-0"
          >
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </Panel>
    </Stack>
  );
}
