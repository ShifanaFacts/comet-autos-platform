'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type { JobCardStatus } from '@/generated/prisma/enums';
import { changeJobStatus } from './actions';

const STATUS_LABEL: Record<JobCardStatus, string> = {
  RECEIVED: 'Received',
  INSPECTING: 'Start inspection',
  DIAGNOSED: 'Mark diagnosed',
  ESTIMATE_SENT: 'Send estimate',
  APPROVED: 'Mark approved',
  IN_PROGRESS: 'Start repair',
  ON_HOLD: 'Put on hold',
  COMPLETED: 'Mark completed',
  INVOICED: 'Mark invoiced',
  CLOSED: 'Close job',
  CANCELLED: 'Cancel job',
};

export function StatusChanger({ jobCardId, allowedNext }: { jobCardId: string; allowedNext: JobCardStatus[] }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (allowedNext.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {allowedNext.map((status) => (
        <Button
          key={status}
          size="sm"
          variant={status === 'CANCELLED' ? 'destructive' : 'outline'}
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await changeJobStatus(jobCardId, status);
              if (result.error) {
                setError(result.error);
              } else {
                router.refresh();
              }
            });
          }}
        >
          {STATUS_LABEL[status]}
        </Button>
      ))}
      {error ? <p className="w-full text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
