'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, PauseCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmAction } from '@/components/shared/confirm-action';
import type { JobCardStatus } from '@/generated/prisma/enums';
import { changeJobStatus } from './actions';

const PRIMARY_LABEL: Record<JobCardStatus, string> = {
  RECEIVED: 'Received',
  INSPECTING: 'Start Inspection',
  DIAGNOSED: 'Mark Diagnosed',
  ESTIMATE_SENT: 'Send Estimate',
  APPROVED: 'Mark Approved',
  IN_PROGRESS: 'Start Repair',
  ON_HOLD: 'Resume',
  COMPLETED: 'Mark Completed',
  INVOICED: 'Mark Invoiced',
  CLOSED: 'Close Job',
  CANCELLED: 'Cancelled',
};

const SECONDARY_LABEL: Record<string, string> = {
  ON_HOLD: 'Put on hold',
  CANCELLED: 'Cancel job',
};

export function StatusChanger({
  jobCardId,
  primaryNext,
  secondaryNext,
}: {
  jobCardId: string;
  primaryNext: JobCardStatus | null;
  secondaryNext: JobCardStatus[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function apply(status: JobCardStatus) {
    setError(null);
    startTransition(async () => {
      const result = await changeJobStatus(jobCardId, status);
      if (result.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  if (!primaryNext && secondaryNext.length === 0) return null;

  return (
    <div className="rounded-lg border border-primary/20 bg-accent/40 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Next action</p>
          {primaryNext ? (
            <p className="text-sm text-muted-foreground">Move this job forward when you&apos;re ready.</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {secondaryNext.includes('ON_HOLD') ? (
            <Button variant="outline" size="sm" disabled={isPending} onClick={() => apply('ON_HOLD')}>
              <PauseCircle />
              {SECONDARY_LABEL.ON_HOLD}
            </Button>
          ) : null}
          {secondaryNext.includes('CANCELLED') ? (
            <ConfirmAction
              trigger={
                <Button variant="ghost" size="sm">
                  <XCircle />
                  {SECONDARY_LABEL.CANCELLED}
                </Button>
              }
              title="Cancel this job card?"
              description="This stops the job permanently. It can't be resumed afterwards — you would need to check the vehicle in again."
              confirmLabel="Cancel job"
              onConfirm={async () => apply('CANCELLED')}
            />
          ) : null}
          {primaryNext ? (
            <Button disabled={isPending} onClick={() => apply(primaryNext)}>
              {PRIMARY_LABEL[primaryNext]}
              <ArrowRight />
            </Button>
          ) : null}
        </div>
      </div>
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
