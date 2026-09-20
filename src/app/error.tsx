'use client';

import { useEffect } from 'react';
import { RotateCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-warning/10 text-warning">
        <TriangleAlert className="size-6" />
      </span>
      <div className="flex max-w-md flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight">This page couldn&apos;t be loaded</h1>
        <p className="text-sm text-muted-foreground">
          The connection may have dropped for a moment. Nothing that was saved has been lost —
          please try again.
        </p>
      </div>
      <Button size="lg" onClick={reset}>
        <RotateCw />
        Try again
      </Button>
    </main>
  );
}
