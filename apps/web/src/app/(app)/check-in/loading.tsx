import { Skeleton } from '@/components/ui/skeleton';

export default function CheckInLoading() {
  return (
    <div className="mx-auto max-w-lg">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="mt-2 h-4 w-64" />
      <div className="mt-6 flex flex-col gap-3">
        <Skeleton className="h-9 w-full rounded-md" />
        <Skeleton className="h-10 w-44 rounded-md" />
      </div>
    </div>
  );
}
