'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Section 24: never show a raw technical error to staff. Next.js already
// strips stack traces/details from what reaches the client in production;
// this is the friendly presentation layer on top of that.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <AlertTriangle className="size-6 text-muted-foreground" />
      <div>
        <p className="text-sm font-medium">Something went wrong loading this page.</p>
        <p className="mt-1 text-sm text-muted-foreground">Please try again — if it keeps happening, let the team know.</p>
      </div>
      <Button size="sm" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
