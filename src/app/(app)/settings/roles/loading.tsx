import { Stack } from '@/components/layout/primitives';
import { Skeleton } from '@/components/ui/skeleton';

export default function RolesLoading() {
  return (
    <Stack gap="2xl">
      <div className="flex flex-col gap-3 border-b border-border pb-8">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-[52px] w-full rounded-xl" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    </Stack>
  );
}
