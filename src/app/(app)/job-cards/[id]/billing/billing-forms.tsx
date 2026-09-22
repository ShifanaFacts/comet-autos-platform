'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FormError, TextField, TextareaField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { ConfirmAction } from '@/components/shared/confirm-action';
import { SignaturePad } from '@/components/media/signature-pad';
import type { ActionResult } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import { createInvoiceAction, deliverVehicleAction } from '../actions';

export function CreateInvoiceButton({ jobCardId, total }: { jobCardId: string; total: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <ConfirmAction
        tone="default"
        trigger={
          <Button size="lg" className="h-11" disabled={isPending}>
            {isPending ? <Loader2 className="animate-spin" /> : <Receipt />}
            Create invoice · {formatMoney(total)}
          </Button>
        }
        title={`Issue the tax invoice for ${formatMoney(total)}?`}
        description="The invoice is issued with the approved work shown here and the job moves to Invoiced. Lines and totals are calculated on the server."
        confirmLabel="Issue invoice"
        onConfirm={async () =>
          startTransition(async () => {
            setError(null);
            const result = await createInvoiceAction(jobCardId);
            if (!result.ok) return setError(result.error ?? 'Could not create the invoice.');
            toast.success('Invoice issued');
            router.refresh();
          })
        }
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

export function DeliveryForm({
  jobCardId,
  customerName,
}: {
  jobCardId: string;
  customerName: string;
}) {
  const [signed, setSigned] = useState(false);
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await deliverVehicleAction(jobCardId, prev, formData);
      if (result.ok) toast.success('Vehicle delivered');
      return result;
    },
    { ok: false },
  );
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <TextareaField
        label="Final notes"
        name="notes"
        placeholder="e.g. Keys and old parts handed to the customer. Next service due at 70,000 km."
        className="[&_textarea]:min-h-20 [&_textarea]:text-base md:[&_textarea]:text-sm"
      />
      <div className="flex flex-col gap-4 border-t border-border pt-5">
        <SignaturePad
          label="Handover signature"
          optionalNote="Optional — the vehicle can be delivered without one."
          onChange={(value) => setSigned(value !== null)}
        />
        {signed ? (
          <TextField
            label="Who signed"
            name="signerName"
            defaultValue={customerName}
            hint="The person collecting the vehicle."
            className="[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm"
          />
        ) : null}
      </div>
      <FormError message={state.error} />
      <SubmitButton
        pending={isPending}
        size="lg"
        className="h-11 self-start"
        pendingLabel="Recording…"
      >
        <KeyRound />
        Deliver vehicle
      </SubmitButton>
    </form>
  );
}
