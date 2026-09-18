import { Panel, Stack } from '@/components/layout/primitives';
import { Skeleton } from '@/components/ui/skeleton';

export default function CheckInLoading() {
  return (
    <Stack gap="2xl">
      <div className="flex flex-col gap-3 border-b border-border pb-8">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Panel className="flex w-full max-w-2xl flex-col gap-6 sm:p-8">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
        <Skeleton className="h-10 w-48 rounded-lg" />
      </Panel>
    </Stack>
  );
}
