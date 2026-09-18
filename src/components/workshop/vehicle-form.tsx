'use client';

import { useRef } from 'react';
import { Field, FormError, NativeSelect, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { LinkButton } from '@/components/shared/link-button';
import type { ActionResult } from '@/lib/errors';
import { PLATE_EMIRATES } from '@/lib/vehicles/constants';

export function VehicleForm({
  action,
  initial,
  submitLabel,
  cancelHref,
  offerCheckIn,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  initial?: {
    plateNumber: string;
    plateEmirate: string | null;
    vin: string | null;
    make: string;
    model: string;
    year: number | null;
    color: string | null;
  };
  submitLabel: string;
  cancelHref: string;
  /** Adds a primary "Save & check in now" that goes straight to Quick Check-In. */
  offerCheckIn?: boolean;
}) {
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(action, { ok: false });
  const nextRef = useRef<HTMLInputElement>(null);
  const errors = state.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <input ref={nextRef} type="hidden" name="next" defaultValue="" />
      <div className="grid gap-6 sm:grid-cols-2">
        <TextField
          label="Registration number"
          name="plateNumber"
          required
          defaultValue={initial?.plateNumber}
          error={errors.plateNumber}
          placeholder="A 12345"
          autoFocus
          className="[&_input]:font-mono [&_input]:uppercase"
        />
        <Field label="Emirate" htmlFor="plateEmirate" hint="Optional">
          <NativeSelect id="plateEmirate" name="plateEmirate" defaultValue={initial ? (initial.plateEmirate ?? '') : 'Dubai'}>
            <option value="">—</option>
            {PLATE_EMIRATES.map((emirate) => (
              <option key={emirate} value={emirate}>
                {emirate}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <TextField label="Make" name="make" required defaultValue={initial?.make} error={errors.make} placeholder="Toyota" />
        <TextField
          label="Model"
          name="model"
          required
          defaultValue={initial?.model}
          error={errors.model}
          placeholder="Land Cruiser"
        />
        <TextField
          label="Year"
          name="year"
          inputMode="numeric"
          defaultValue={initial?.year ?? ''}
          error={errors.year}
          hint="Optional"
        />
        <TextField label="Colour" name="color" defaultValue={initial?.color ?? ''} error={errors.color} hint="Optional" />
        <TextField
          label="VIN"
          name="vin"
          defaultValue={initial?.vin ?? ''}
          error={errors.vin}
          hint="Optional — 17 characters, on the windscreen or door frame."
          className="sm:col-span-2 [&_input]:font-mono [&_input]:uppercase"
        />
      </div>
      <FormError message={errors.plateNumber || errors.vin ? undefined : state.error} />
      <div className="flex flex-wrap gap-3 border-t border-border pt-6">
        {offerCheckIn ? (
          <SubmitButton
            pending={isPending}
            size="lg"
            pendingLabel="Saving…"
            onClick={() => {
              if (nextRef.current) nextRef.current.value = 'check-in';
            }}
          >
            Save &amp; check in now
          </SubmitButton>
        ) : null}
        <SubmitButton
          pending={isPending}
          size="lg"
          variant={offerCheckIn ? 'outline' : 'default'}
          pendingLabel="Saving…"
          onClick={() => {
            if (nextRef.current) nextRef.current.value = '';
          }}
        >
          {submitLabel}
        </SubmitButton>
        <LinkButton href={cancelHref} variant="ghost" size="lg">
          Cancel
        </LinkButton>
      </div>
    </form>
  );
}
