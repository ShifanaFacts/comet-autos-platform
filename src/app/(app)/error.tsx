'use client';

import Link from 'next/link';
import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Home, Loader2, RotateCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Shown when a page fails to load. Never the technical error itself (Next.js
 * strips it in production; it is logged on the server) — a plain
 * explanation, reassurance that nothing was lost, and a way forward.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    console.error(error);
  }, [error]);

  function retry() {
    startTransition(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-5 px-6 py-20 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-warning/10 text-warning">
        <TriangleAlert className="size-6" />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight">This page couldn&apos;t be loaded</h1>
        <p className="text-sm text-muted-foreground">
          The connection to the workshop system may have dropped for a moment. Nothing you saved has
          been lost. Try again — if it keeps happening, tell the workshop manager
          {error.digest ? (
            <>
              {' '}
              and quote reference <span className="font-mono text-foreground">{error.digest}</span>
            </>
          ) : null}
          .
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button size="lg" onClick={retry} disabled={isPending}>
          {isPending ? <Loader2 className="animate-spin" /> : <RotateCw />}
          Try again
        </Button>
        <Button size="lg" variant="outline" nativeButton={false} render={<Link href="/" />}>
          <Home />
          Dashboard
        </Button>
      </div>
    </div>
  );
}
