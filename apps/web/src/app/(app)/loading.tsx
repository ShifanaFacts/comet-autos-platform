import { Skeleton } from '@/components/ui/skeleton';

// Generic route-level loading state (section 23): a shape-matched skeleton
// rather than a full-screen spinner, shown by Next.js while a page's async
// Server Component data is being fetched.
export default function AppLoading() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-end justify-between">
        <div>
          <Skeleton className="h-7 w-48" />
          <Skeleton className="mt-2 h-4 w-32" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-40 rounded-lg" />
    </div>
  );
}
