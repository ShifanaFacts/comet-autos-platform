import { Panel, Stack } from '@/components/layout/primitives';
import { Skeleton } from '@/components/ui/skeleton';

export default function JobCardDetailLoading() {
  return (
    <Stack gap="2xl">
      <div className="flex flex-col gap-3 border-b border-border pb-8">
        <Skeleton className="h-4 w-24" />
        <div className="flex items-start gap-4">
          <Skeleton className="h-10 w-32 rounded-md" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
      </div>

      <Stack gap="lg">
        <Panel>
          <div className="flex items-center">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="flex flex-1 items-center last:flex-none">
                <Skeleton className="size-6 shrink-0 rounded-full" />
                {i < 11 ? <Skeleton className="mx-2 h-px flex-1" /> : null}
              </div>
            ))}
          </div>
        </Panel>
        <Skeleton className="h-16 rounded-xl" />
      </Stack>

      <div className="grid gap-8 lg:grid-cols-12">
        <Skeleton className="h-40 rounded-xl lg:col-span-7" />
        <Skeleton className="h-40 rounded-xl lg:col-span-5" />
      </div>
    </Stack>
  );
}
