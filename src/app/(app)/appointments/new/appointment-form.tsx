'use client';

import { useState } from 'react';
import { TriangleAlert, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FormError, NativeSelect, TextareaField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { LinkButton } from '@/components/shared/link-button';
import { VehiclePlate } from '@/components/shared/vehicle-plate';
import { VehiclePicker } from '@/components/workshop/vehicle-picker';
import type { ActionResult } from '@/lib/errors';
import type { VehicleSummary } from '@/lib/vehicles/summary';
import { createAppointmentAction } from '../actions';

const DURATIONS = [
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
  { value: '120', label: '2 hours' },
  { value: '240', label: 'Half day' },
  { value: '480', label: 'Full day' },
];

export function AppointmentForm({
  initialVehicle,
  defaultScheduledAt,
  minScheduledAt,
}: {
  initialVehicle: VehicleSummary | null;
  defaultScheduledAt: string;
  minScheduledAt: string;
}) {
  const [vehicle, setVehicle] = useState<VehicleSummary | null>(initialVehicle);
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(createAppointmentAction, { ok: false });
  const errors = state.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8">
      <input type="hidden" name="vehicleId" value={vehicle?.vehicleId ?? ''} />

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold tracking-tight">Vehicle</h2>
        {vehicle ? (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-muted/40 p-4">
            <div className="flex min-w-0 items-center gap-4">
              <VehiclePlate plateNumber={vehicle.plateNumber} />
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {vehicle.make} {vehicle.model} {vehicle.year ?? ''}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {vehicle.customer.name} · {vehicle.customer.phone}
                </p>
              </div>
            </div>
            <Button type="button" variant="ghost" onClick={() => setVehicle(null)}>
              Change
            </Button>
          </div>
        ) : (
          <VehiclePicker
            autoFocus
            onSelect={setVehicle}
            footer={
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span>New customer?</span>
                <LinkButton href="/customers/new" variant="outline">
                  <UserPlus />
                  Add customer &amp; vehicle first
                </LinkButton>
              </div>
            }
          />
        )}
        {errors.vehicleId ? <p className="text-xs text-destructive">{errors.vehicleId}</p> : null}
        {vehicle?.openAppointment ? (
          <p className="flex items-center gap-2 text-sm text-warning">
            <TriangleAlert className="size-4" />
            This vehicle already has an open booking. Check the appointments list before booking again.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-6 border-t border-border pt-8">
        <h2 className="text-base font-semibold tracking-tight">When &amp; what</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Date and time" htmlFor="scheduledAt" required error={errors.scheduledAt}>
            <Input
              id="scheduledAt"
              name="scheduledAt"
              type="datetime-local"
              step={900}
              min={minScheduledAt}
              defaultValue={defaultScheduledAt}
              required
            />
          </Field>
          <Field label="Expected duration" htmlFor="estimatedDurationMinutes" hint="Optional">
            <NativeSelect id="estimatedDurationMinutes" name="estimatedDurationMinutes" defaultValue="60">
              <option value="">Not sure</option>
              {DURATIONS.map((duration) => (
                <option key={duration.value} value={duration.value}>
                  {duration.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <TextareaField
          label="Work requested"
          name="notes"
          required
          error={errors.notes}
          placeholder="e.g. 40,000 km service; AC weak on hot days"
          hint="Carried over as the complaint when the vehicle is checked in."
        />
      </section>

      <FormError message={state.error && !errors.vehicleId && !errors.scheduledAt ? state.error : undefined} />
      <div className="flex flex-wrap gap-3 border-t border-border pt-6">
        <SubmitButton pending={isPending} size="lg" disabled={!vehicle} pendingLabel="Booking…">
          Book appointment
        </SubmitButton>
        <LinkButton href="/appointments" variant="ghost" size="lg">
          Cancel
        </LinkButton>
      </div>
    </form>
  );
}
