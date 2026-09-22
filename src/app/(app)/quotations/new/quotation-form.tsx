'use client';

import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useFormAction } from '@/components/forms/use-form-action';
import { FormError } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { CustomerPicker, type PickedParty } from '@/components/workshop/customer-picker';
import type { ActionResult } from '@/lib/errors';
import type { CustomerOption } from '@/lib/customers/picker';
import { createQuotationAction } from '../actions';

/**
 * Starting a quotation: who it is for, and nothing else. Prices are added on
 * the quotation itself, so this screen never grows past one decision.
 */
export function NewQuotationForm({ initialCustomer }: { initialCustomer: CustomerOption | null }) {
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(createQuotationAction, {
    ok: false,
  });
  const [picked, setPicked] = useState<PickedParty | null>(
    initialCustomer
      ? {
          customer: initialCustomer,
          vehicleId: initialCustomer.vehicles.length === 1 ? initialCustomer.vehicles[0].id : '',
          jobCardId: '',
        }
      : null,
  );
  const errors = state.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8">
      <input type="hidden" name="customerId" value={picked?.customer.id ?? ''} />
      <input type="hidden" name="vehicleId" value={picked?.vehicleId ?? ''} />
      <input type="hidden" name="jobCardId" value={picked?.jobCardId ?? ''} />

      <CustomerPicker value={picked} onChange={setPicked} autoFocus={!initialCustomer} />

      <FormError message={state.error ?? errors.customerId ?? errors.vehicleId ?? errors.jobCardId} />

      {picked ? (
        <div className="border-t border-border pt-6">
          <SubmitButton
            pending={isPending}
            size="lg"
            className="w-full sm:w-auto"
            pendingLabel="Creating…"
          >
            Create quotation
            <ArrowRight />
          </SubmitButton>
          <p className="mt-3 text-sm text-muted-foreground">
            Labour, parts and VAT are added on the next screen.
          </p>
        </div>
      ) : null}
    </form>
  );
}
