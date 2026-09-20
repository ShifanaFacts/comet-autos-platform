import Link from 'next/link';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Shown when a signed-in user opens a page their role doesn't include (the server refuses the data regardless). */
export function AccessDenied({ what }: { what: string }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-5 px-6 py-20 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Lock className="size-6" />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight">
          You don&apos;t have access to {what}
        </h1>
        <p className="text-sm text-muted-foreground">
          Your role doesn&apos;t include this part of the system. Ask the workshop owner or manager
          if you need it.
        </p>
      </div>
      <Button size="lg" nativeButton={false} render={<Link href="/" />}>
        Back to the dashboard
      </Button>
    </div>
  );
}
