'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import {
  Field,
  FormError,
  NativeSelect,
  TextField,
  TextareaField,
} from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import type { ActionResult } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import { MoneyAccountField } from '@/components/accounting/money-account-field';
import type { AccountChoice } from '@/lib/accounting/reports';
import type { PaymentModeOption } from '@/lib/accounting/payment-modes';
import { PaymentModeField } from '@/components/accounting/payment-mode-field';
import { recordInvoicePaymentAction } from '@/app/(app)/finance/invoices/actions';

/*
 * Taking money against an invoice. One form for both doors into billing —
 * the job-card screen and the invoice's own page — so the payment rules,
 * the wording and the duplicate protection are the same wherever the owner
 * happens to be standing.
 */

/** How a customer can pay — shared by every form that takes a payment. */
export const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'CARD', label: 'Card' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'ONLINE', label: 'Online' },
];

export function InvoicePaymentForm({
  invoiceId,
  balance,
  now,
  moneyAccounts = [],
  modes = [],
}: {
  invoiceId: string;
  /** Cash, bank and card accounts the money can go into. */
  moneyAccounts?: AccountChoice[];
  /** The receipt modes (payment mode master). Given, one choice sets method and account. */
  modes?: PaymentModeOption[];
  /** Outstanding balance, pre-filled as the most likely amount. */
  balance: string;
  /** "now" as a datetime-local value, computed on the server in workshop time. */
  now: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [amount, setAmount] = useState(balance);
  const [needsReference, setNeedsReference] = useState(
    (modes.find((mode) => mode.isDefault) ?? modes[0])?.requiresReference ?? false,
  );
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await recordInvoicePaymentAction(invoiceId, prev, formData);
      if (result.ok) {
        toast.success('Payment recorded');
        formRef.current?.reset();
        router.refresh();
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="grid gap-6 md:grid-cols-2">
        <TextField
          label="Amount received (AED)"
          name="amount"
          required
          numeric="money"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          error={errors.amount}
          hint={`Balance due ${formatMoney(balance)}. Enter less for a part payment.`}
          className="[&_input]:h-12 [&_input]:text-base md:[&_input]:h-11 md:[&_input]:text-sm"
        />
        {modes.length ? (
          <PaymentModeField
            id={`mode-${invoiceId}`}
            modes={modes}
            label="Received by"
            error={errors.method ?? errors.accountId}
            onChange={(mode) => setNeedsReference(mode?.requiresReference ?? false)}
          />
        ) : (
          <Field label="Method" htmlFor="method" required error={errors.method}>
            <NativeSelect
              id="method"
              name="method"
              required
              defaultValue="CASH"
              className="h-12 text-base md:h-11 md:text-sm"
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method.value} value={method.value}>
                  {method.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        <Field label="Received" htmlFor="receivedAt" required error={errors.receivedAt}>
          <Input
            id="receivedAt"
            name="receivedAt"
            type="datetime-local"
            required
            defaultValue={now}
            max={now}
            className="h-12 text-base md:h-11 md:text-sm"
          />
        </Field>
        <TextField
          label="Reference"
          name="referenceNumber"
          required={needsReference}
          error={errors.referenceNumber}
          hint="Card slip, transfer or cheque number."
          className="[&_input]:h-12 [&_input]:text-base md:[&_input]:h-11 md:[&_input]:text-sm"
        />
        {moneyAccounts.length && !modes.length ? (
          <MoneyAccountField
            id={`accountId-${invoiceId}`}
            name="accountId"
            label="Deposited into"
            accounts={moneyAccounts}
            error={errors.accountId}
          />
        ) : null}
      </div>
      <TextareaField
        label="Notes"
        name="notes"
        error={errors.notes}
        className="[&_textarea]:min-h-16"
      />
      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <div className="border-t border-border pt-4">
        <SubmitButton
          pending={isPending}
          size="lg"
          className="h-12 w-full sm:h-11 sm:w-auto"
          pendingLabel="Recording…"
        >
          <Wallet />
          Record payment
        </SubmitButton>
      </div>
    </form>
  );
}
