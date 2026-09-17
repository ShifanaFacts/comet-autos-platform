'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <AlertTriangle className="size-6 text-muted-foreground" />
      <div>
        <p className="text-sm font-medium">Something went wrong.</p>
        <p className="mt-1 text-sm text-muted-foreground">Please try again.</p>
      </div>
      <Button size="sm" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
