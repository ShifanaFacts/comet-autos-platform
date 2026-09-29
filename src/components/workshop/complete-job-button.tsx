'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmAction } from '@/components/shared/confirm-action';
import { markJobCompletedAction } from '@/app/(app)/job-cards/[id]/actions';

/**
 * The work is done: marks the job Completed — ready to invoice and hand
 * over. Payment is not needed for this, nor for the handover.
 */
export function CompleteJobButton({
  jobCardId,
  variant = 'outline',
}: {
  jobCardId: string;
  variant?: 'default' | 'outline';
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      <ConfirmAction
        tone="default"
        trigger={
          <Button variant={variant} size="lg" disabled={isPending}>
            <CheckCircle2 />
            {isPending ? 'Updating…' : 'Mark completed'}
          </Button>
        }
        title="Mark the work completed?"
        description="The job becomes Completed — ready to invoice and hand over. The customer can pay now or later."
        confirmLabel="Mark completed"
        onConfirm={async () =>
          startTransition(async () => {
            setError(null);
            const result = await markJobCompletedAction(jobCardId);
            if (result.ok) toast.success('Job marked completed');
            else setError(result.error ?? 'Could not mark the job completed.');
          })
        }
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
