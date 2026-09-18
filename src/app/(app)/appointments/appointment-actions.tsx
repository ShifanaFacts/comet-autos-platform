'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmAction } from '@/components/shared/confirm-action';
import { changeAppointmentStatusAction } from './actions';

export function AppointmentStatusButtons({ appointmentId, canConfirm }: { appointmentId: string; canConfirm: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function apply(status: 'CONFIRMED' | 'CANCELLED' | 'NO_SHOW', message: string) {
    setError(null);
    startTransition(async () => {
      const result = await changeAppointmentStatusAction(appointmentId, status);
      if (!result.ok) return setError(result.error ?? 'Could not update the appointment.');
      toast.success(message);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        {canConfirm ? (
          <Button size="sm" variant="outline" disabled={isPending} onClick={() => apply('CONFIRMED', 'Appointment confirmed')}>
            Confirm
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" disabled={isPending} onClick={() => apply('NO_SHOW', 'Marked as no-show')}>
          No-show
        </Button>
        <ConfirmAction
          trigger={
            <Button size="sm" variant="ghost" disabled={isPending}>
              Cancel
            </Button>
          }
          title="Cancel this appointment?"
          description="The booking is kept in the history as cancelled."
          confirmLabel="Cancel appointment"
          onConfirm={async () => apply('CANCELLED', 'Appointment cancelled')}
        />
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
