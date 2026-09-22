'use client';

import Link from 'next/link';
import { ArrowLeftRight, UserRound } from 'lucide-react';
import { FormError, TextField, TextareaField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { LinkButton } from '@/components/shared/link-button';
import type { ActionResult } from '@/lib/errors';
import { transferVehicleAction } from '@/app/(app)/customers/actions';

const INPUT = '[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm';

/**
 * The confirmation half of changing a vehicle's owner: who it goes to, why,
 * and the registration typed back so a vehicle is never handed over by a
 * stray tap. The server checks all three again.
 */
export function TransferVehicleForm({
  vehicleId,
  plateNumber,
  previousOwnerName,
  newOwner,
  changeHref,
}: {
  vehicleId: string;
  plateNumber: string;
  previousOwnerName: string;
  newOwner: { id: string; name: string; phone: string };
  changeHref: string;
}) {
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    transferVehicleAction.bind(null, vehicleId),
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <input type="hidden" name="customerId" value={newOwner.id} />

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Moving to
        </span>
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <UserRound className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium">{newOwner.name}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{newOwner.phone}</span>
          </div>
          <Link
            href={changeHref}
            className="ml-auto text-sm font-medium text-primary hover:text-primary-hover"
          >
            Change
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">
          {previousOwnerName} keeps every job, invoice and approval already on this vehicle.
        </p>
      </div>

      <TextareaField
        label="Why is the owner changing?"
        name="reason"
        required
        placeholder="e.g. Vehicle sold — new owner brought the registration card"
        error={errors.reason}
        className="[&_textarea]:min-h-20 [&_textarea]:text-base md:[&_textarea]:text-sm"
      />

      <TextField
        label="Type the registration to confirm"
        name="confirmPlate"
        required
        autoComplete="off"
        placeholder={plateNumber}
        hint="This cannot be undone from the app, so we ask you to confirm."
        error={errors.confirmPlate}
        className={`${INPUT} [&_input]:font-mono [&_input]:uppercase`}
      />

      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <div className="flex flex-wrap gap-3 border-t border-border pt-6">
        <SubmitButton pending={isPending} size="lg" className="h-11" pendingLabel="Changing…">
          <ArrowLeftRight />
          Change owner
        </SubmitButton>
        <LinkButton href={`/vehicles/${vehicleId}`} variant="ghost" size="lg" className="h-11">
          Cancel
        </LinkButton>
      </div>
    </form>
  );
}
