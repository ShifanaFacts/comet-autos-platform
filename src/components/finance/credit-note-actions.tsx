'use client';

import { useRouter } from 'next/navigation';
import { Ban, HandCoins } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Field, FormError, NativeSelect, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { ReasonAction } from '@/components/shared/reason-action';
import { MoneyAccountField } from '@/components/accounting/money-account-field';
import type { AccountChoice } from '@/lib/accounting/reports';
import type { PaymentModeOption } from '@/lib/accounting/payment-modes';
import { PaymentModeField } from '@/components/accounting/payment-mode-field';
import type { ActionResult } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import { PAYMENT_METHODS } from '@/components/finance/invoice-payment-form';
import {
  recordCreditNoteRefundAction,
  voidCreditNoteAction,
} from '@/app/(app)/finance/credit-notes/actions';

/** Records the money owed back under a credit note as paid to the customer. */
export function CreditNoteRefundForm({
  creditNoteId,
  invoiceId,
  amount,
  today,
  moneyAccounts,
  modes = [],
}: {
  creditNoteId: string;
  invoiceId: string;
  amount: string;
  today: string;
  moneyAccounts: AccountChoice[];
  /** The payment modes (payment mode master). Given, one choice sets method and account. */
  modes?: PaymentModeOption[];
}) {
  const router = useRouter();
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await recordCreditNoteRefundAction(creditNoteId, invoiceId, prev, formData);
      if (result.ok) {
        toast.success('Refund recorded');
        router.refresh();
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <p className="text-sm">
        <span className="font-semibold">{formatMoney(amount)}</span> is owed back to the customer.
        Record it here once it has been paid.
      </p>
      <div className="grid gap-6 md:grid-cols-2">
        <Field label="Refunded on" htmlFor="refundedOn" required error={errors.refundedOn}>
          <Input
            id="refundedOn"
            name="refundedOn"
            type="date"
            required
            defaultValue={today}
            max={today}
            className="h-11"
          />
        </Field>
        {modes.length ? (
          <PaymentModeField
            id={`refund-mode-${creditNoteId}`}
            modes={modes}
            label="Refunded by"
            error={errors.method ?? errors.accountId}
            className="h-11"
          />
        ) : (
          <Field label="Method" htmlFor="refund-method" required error={errors.method}>
            <NativeSelect id="refund-method" name="method" defaultValue="CASH" className="h-11">
              {PAYMENT_METHODS.map((method) => (
                <option key={method.value} value={method.value}>
                  {method.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        {moneyAccounts.length && !modes.length ? (
          <MoneyAccountField
            id={`refund-account-${creditNoteId}`}
            name="accountId"
            label="Paid from"
            accounts={moneyAccounts}
            error={errors.accountId}
          />
        ) : null}
        <TextField
          label="Reference"
          name="reference"
          error={errors.reference}
          hint="Transfer or cheque number."
          className="[&_input]:h-11"
        />
      </div>
      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <div>
        <SubmitButton pending={isPending} className="h-11" pendingLabel="Recording…">
          <HandCoins />
          Record refund
        </SubmitButton>
      </div>
    </form>
  );
}

/** Withdraws a credit note issued in error. */
export function VoidCreditNoteButton({
  creditNoteId,
  creditNoteNumber,
}: {
  creditNoteId: string;
  creditNoteNumber: string;
}) {
  return (
    <ReasonAction
      trigger={
        <Button variant="outline" className="h-10">
          <Ban />
          Void
        </Button>
      }
      title={`Void credit note ${creditNoteNumber}?`}
      description="It stays on record, marked void, and its number is not reused. The invoice is owed again and the VAT it took off comes back."
      placeholder="e.g. Issued against the wrong invoice."
      confirmLabel="Void credit note"
      successMessage={`Credit note ${creditNoteNumber} voided`}
      onConfirm={(input) => voidCreditNoteAction(creditNoteId, input)}
    />
  );
}
