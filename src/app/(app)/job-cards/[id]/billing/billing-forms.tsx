'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, Receipt, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FormError, NativeSelect, TextField, TextareaField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { ConfirmAction } from '@/components/shared/confirm-action';
import type { ActionResult } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import { createInvoiceAction, deliverVehicleAction, recordPaymentAction } from '../actions';

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

const METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'CARD', label: 'Card' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'ONLINE', label: 'Online' },
];

export function PaymentForm({ jobCardId, balance, now }: { jobCardId: string; balance: string; now: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [amount, setAmount] = useState(balance);
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(async (prev, formData) => {
    const result = await recordPaymentAction(jobCardId, prev, formData);
    if (result.ok) {
      toast.success('Payment recorded');
      formRef.current?.reset();
    }
    return result;
  }, { ok: false });
  const errors = state.fieldErrors ?? {};

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="grid gap-6 md:grid-cols-2">
        <TextField
          label="Amount received (AED)"
          name="amount"
          required
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          error={errors.amount}
          hint={`Balance due ${formatMoney(balance)}. Enter less for a part payment.`}
          className="[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm"
        />
        <Field label="Method" htmlFor="method" required error={errors.method}>
          <NativeSelect id="method" name="method" required defaultValue="CASH" className="h-11 text-base md:text-sm">
            {METHODS.map((method) => (
              <option key={method.value} value={method.value}>
                {method.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Received" htmlFor="receivedAt" required error={errors.receivedAt}>
          <Input id="receivedAt" name="receivedAt" type="datetime-local" required defaultValue={now} max={now} className="h-11 text-base md:text-sm" />
        </Field>
        <TextField
          label="Reference"
          name="referenceNumber"
          error={errors.referenceNumber}
          hint="Card slip, transfer or cheque number."
          className="[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm"
        />
      </div>
      <TextareaField label="Notes" name="notes" error={errors.notes} className="[&_textarea]:min-h-16" />
      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <div className="border-t border-border pt-4">
        <SubmitButton pending={isPending} size="lg" className="h-11" pendingLabel="Recording…">
          <Wallet />
          Record payment
        </SubmitButton>
      </div>
    </form>
  );
}

export function DeliveryForm({ jobCardId }: { jobCardId: string }) {
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(async (prev, formData) => {
    const result = await deliverVehicleAction(jobCardId, prev, formData);
    if (result.ok) toast.success('Vehicle delivered');
    return result;
  }, { ok: false });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <TextareaField
        label="Final notes"
        name="notes"
        placeholder="e.g. Keys and old parts handed to the customer. Next service due at 70,000 km."
        className="[&_textarea]:min-h-20 [&_textarea]:text-base md:[&_textarea]:text-sm"
      />
      <FormError message={state.error} />
      <SubmitButton pending={isPending} size="lg" className="h-11 self-start" pendingLabel="Recording…">
        <KeyRound />
        Deliver vehicle
      </SubmitButton>
    </form>
  );
}
