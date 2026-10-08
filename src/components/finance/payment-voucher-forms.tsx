'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, FileSignature, HandCoins } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Field,
  FormError,
  NativeSelect,
  TextField,
  TextareaField,
} from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { ReasonAction } from '@/components/shared/reason-action';
import { PaymentModeField } from '@/components/accounting/payment-mode-field';
import type { ActionResult } from '@/lib/errors';
import type { PaymentVoucherFormOptions } from '@/lib/finance/payment-vouchers';
import { formatMoney } from '@/lib/format';
import { calculateLine, filsToString, toFils } from '@/lib/money';
import {
  payCardCollectionAction,
  recordCardCollectionAction,
  recordWorkPaymentAction,
  voidPaymentVoucherAction,
} from '@/app/(app)/finance/payment-vouchers/actions';

/*
 * The payment voucher forms: card money collected for someone (paid over
 * now or later), paying it over, and outside work paid for. The figures —
 * the bank's fee, its VAT and what is handed over — are worked out here
 * exactly as the server works them out, so what the form shows is what the
 * voucher will say.
 */

const INPUT = '[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm';
const MONEY = /^\d{1,9}(\.\d{1,2})?$/;
const RATE = /^\d{1,2}(\.\d{1,2})?$/;

/** `rate`% of an amount, rounded like a VAT line; '' until both are valid. */
function percentOf(amount: string, rate: string) {
  if (!MONEY.test(amount.trim()) || !RATE.test(rate.trim()) || Number(rate) <= 0) return '';
  return calculateLine({ quantity: '1', unitPrice: amount.trim(), taxRate: rate.trim() }).taxAmount;
}

const fils = (value: string) => (MONEY.test(value.trim()) ? toFils(value.trim()) : 0);

type Options = PaymentVoucherFormOptions;

/** Who is paid: a name (people paid before are suggested) and a phone number. */
function PayeeFields({ options, errors }: { options: Options; errors: Record<string, string> }) {
  const listId = useId();
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <TextField
        label="Paid to"
        name="payeeName"
        id="voucher-payee"
        required
        list={listId}
        autoComplete="off"
        placeholder="e.g. Al Noor Upholstery — Rashid"
        error={errors.payeeName}
        hint="The person or business that signs for the money."
        className={INPUT}
      />
      <datalist id={listId}>
        {options.payees.map((payee) => (
          <option key={payee.payeeName} value={payee.payeeName} />
        ))}
      </datalist>
      <TextField
        label="Their phone"
        name="payeePhone"
        id="voucher-phone"
        inputMode="tel"
        error={errors.payeePhone}
        hint="Optional."
        className={INPUT}
      />
    </div>
  );
}

/**
 * Handing card money over: the day, the bank's fee (rate, fee, VAT on it),
 * how it was paid — and the sum: collected, less the fee and its VAT, is
 * what is handed over.
 */
function PayOverFields({
  options,
  collected,
  today,
  errors,
}: {
  options: Options;
  /** The amount collected, as typed or stored. */
  collected: string;
  today: string;
  errors: Record<string, string>;
}) {
  const [rate, setRate] = useState(options.lastFeeRate);
  const [ownFee, setOwnFee] = useState<string | null>(null);
  const [ownVat, setOwnVat] = useState<string | null>(null);
  const fee = ownFee ?? percentOf(collected, rate);
  const vat = ownVat ?? percentOf(fee, options.vatRate);
  const handedOver = fils(collected) - fils(fee) - fils(vat);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 sm:grid-cols-3">
        <TextField
          label="Bank's card fee (%)"
          name="feeRate"
          id="voucher-fee-rate"
          numeric="rate"
          value={rate}
          onChange={(event) => {
            setRate(event.target.value);
            setOwnFee(null);
            setOwnVat(null);
          }}
          error={errors.feeRate}
          hint={options.lastFeeRate ? 'As last time. Change it if the bank’s rate changed.' : 'What the bank charges on card payments.'}
          className={INPUT}
        />
        <TextField
          label="Bank's fee (AED)"
          name="feeAmount"
          id="voucher-fee"
          numeric="money"
          value={fee}
          onChange={(event) => {
            setOwnFee(event.target.value);
            setOwnVat(null);
          }}
          error={errors.feeAmount}
          hint="Worked out from the rate. Type the bank statement’s figure if it differs."
          className={`${INPUT} [&_input]:text-right [&_input]:tabular-nums`}
        />
        <TextField
          label="VAT on the fee (AED)"
          name="feeVatAmount"
          id="voucher-fee-vat"
          numeric="money"
          value={vat}
          onChange={(event) => setOwnVat(event.target.value)}
          error={errors.feeVatAmount}
          hint="The bank charges VAT on its fee."
          className={`${INPUT} [&_input]:text-right [&_input]:tabular-nums`}
        />
      </div>

      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
        <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 tabular-nums">
          <dt className="text-muted-foreground">Collected on the card machine</dt>
          <dd className="text-right">{formatMoney(filsToString(fils(collected)))}</dd>
          <dt className="text-muted-foreground">Less the bank&apos;s fee</dt>
          <dd className="text-right">{`- ${formatMoney(filsToString(fils(fee)))}`}</dd>
          <dt className="text-muted-foreground">Less VAT on the fee</dt>
          <dd className="text-right">{`- ${formatMoney(filsToString(fils(vat)))}`}</dd>
          <dt className="border-t border-border pt-1 font-semibold">Hand over</dt>
          <dd className="border-t border-border pt-1 text-right font-semibold">
            {handedOver > 0 ? formatMoney(filsToString(handedOver)) : '—'}
          </dd>
        </dl>
      </div>

      <div className="grid gap-6 sm:grid-cols-3">
        <TextField
          label="Paid on"
          name="paidOn"
          id="voucher-paid-on"
          type="date"
          required
          defaultValue={today}
          max={today}
          error={errors.paidOn}
          className={INPUT}
        />
        <PaymentModeField
          id="voucher-paid-by"
          modes={options.modes}
          label="Paid from"
          methodName="paymentMethod"
          accountName="paidFromAccountId"
          error={errors.paymentMethod ?? errors.paidFromAccountId}
          className="h-11 text-base md:text-sm"
        />
        <TextField
          label="Reference"
          name="paymentReference"
          id="voucher-reference"
          error={errors.paymentReference}
          hint="Optional: a transfer or cheque number."
          className={INPUT}
        />
      </div>
    </div>
  );
}

/** Card money taken on the workshop's machine for someone else. */
export function CardCollectionForm({ options, today }: { options: Options; today: string }) {
  const router = useRouter();
  const [collected, setCollected] = useState('');
  const [payNow, setPayNow] = useState(true);
  const [state, onSubmit, isPending] = useFormAction<ActionResult<{ id: string }>>(
    async (prev, formData) => {
      const result = await recordCardCollectionAction(prev, formData);
      if (result.ok && result.data) {
        toast.success(payNow ? 'Paid over — print the voucher for them to sign' : 'Recorded as owed to them');
        router.push(`/finance/payment-vouchers/${result.data.id}`);
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8">
      <PayeeFields options={options} errors={errors} />
      <TextField
        label="What for"
        name="description"
        id="voucher-description"
        required
        defaultValue="Their customer paid on our card machine"
        error={errors.description}
        hint="Printed on the voucher, e.g. the car or the work it was for."
        className={INPUT}
      />

      <fieldset className="flex flex-col gap-6">
        <legend className="mb-4 text-[15px] font-semibold">The card payment</legend>
        <div className="grid gap-6 sm:grid-cols-3">
          <TextField
            label="Amount paid on the card (AED)"
            name="collectedAmount"
            id="voucher-collected"
            numeric="money"
            required
            value={collected}
            onChange={(event) => setCollected(event.target.value)}
            error={errors.collectedAmount}
            className={`${INPUT} [&_input]:text-right [&_input]:tabular-nums`}
          />
          <TextField
            label="Day it was paid"
            name="collectedOn"
            id="voucher-collected-on"
            type="date"
            required
            defaultValue={today}
            max={today}
            error={errors.collectedOn}
            className={INPUT}
          />
          <TextField
            label="Card slip number"
            name="cardReference"
            id="voucher-card-reference"
            error={errors.cardReference}
            hint="Optional: the approval or slip number."
            className={INPUT}
          />
        </div>
        {options.cardAccounts.length > 1 ? (
          <Field label="Card machine" htmlFor="voucher-card-account" error={errors.cardAccountId}>
            <NativeSelect
              id="voucher-card-account"
              name="cardAccountId"
              defaultValue={options.cardAccounts[0].id}
              className="h-11 text-base md:text-sm"
            >
              {options.cardAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-6">
        <legend className="mb-4 text-[15px] font-semibold">Paying it over</legend>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="payNow"
            value="now"
            checked={payNow}
            onChange={(event) => setPayNow(event.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            <span className="font-medium">Pay them now</span>
            <span className="block text-muted-foreground">
              Untick to record it as owed to them, and pay it over later from this voucher.
            </span>
          </span>
        </label>
        {payNow ? (
          <PayOverFields options={options} collected={collected} today={today} errors={errors} />
        ) : null}
      </fieldset>

      <TextareaField
        label="Notes"
        name="notes"
        id="voucher-notes"
        error={errors.notes}
        className="[&_textarea]:min-h-16"
      />
      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <div className="border-t border-border pt-4">
        <SubmitButton pending={isPending} size="lg" className="h-11" pendingLabel="Saving…">
          <FileSignature />
          {payNow ? 'Pay over and make voucher' : 'Record as owed'}
        </SubmitButton>
      </div>
    </form>
  );
}

/** Paying over card money recorded earlier as owed. */
export function PayOverForm({
  voucherId,
  collected,
  options,
  today,
}: {
  voucherId: string;
  collected: string;
  options: Options;
  today: string;
}) {
  const router = useRouter();
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await payCardCollectionAction(voucherId, prev, formData);
      if (result.ok) {
        toast.success('Paid over — print the voucher for them to sign');
        router.refresh();
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <PayOverFields options={options} collected={collected} today={today} errors={errors} />
      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <div>
        <SubmitButton pending={isPending} size="lg" className="h-11" pendingLabel="Paying…">
          <HandCoins />
          Pay over
        </SubmitButton>
      </div>
    </form>
  );
}

/** Outside work paid for: an outside mechanic, a sublet repair. */
export function WorkPaymentForm({ options, today }: { options: Options; today: string }) {
  const router = useRouter();
  const [state, onSubmit, isPending] = useFormAction<ActionResult<{ id: string }>>(
    async (prev, formData) => {
      const result = await recordWorkPaymentAction(prev, formData);
      if (result.ok && result.data) {
        toast.success('Paid — print the voucher for them to sign');
        router.push(`/finance/payment-vouchers/${result.data.id}`);
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <PayeeFields options={options} errors={errors} />
      <TextField
        label="What for"
        name="description"
        id="voucher-description"
        required
        placeholder="e.g. Gearbox overhaul — outside mechanic"
        error={errors.description}
        className={INPUT}
      />
      <div className="grid gap-6 sm:grid-cols-2">
        <TextField
          label="Amount paid (AED)"
          name="amount"
          id="voucher-amount"
          numeric="money"
          required
          error={errors.amount}
          hint="No VAT. Someone who gives a tax invoice with VAT goes in Expenses with their bill."
          className={`${INPUT} [&_input]:text-right [&_input]:tabular-nums`}
        />
        <TextField
          label="Paid on"
          name="paidOn"
          id="voucher-paid-on"
          type="date"
          required
          defaultValue={today}
          max={today}
          error={errors.paidOn}
          className={INPUT}
        />
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          label="Booked as"
          htmlFor="voucher-category"
          error={errors.categoryId}
          hint="Work on a customer’s car is a cost of sales: sublet repairs."
        >
          <NativeSelect
            id="voucher-category"
            name="categoryId"
            defaultValue={options.defaultCategoryId}
            className="h-11 text-base md:text-sm"
          >
            <option value="">Miscellaneous expenses</option>
            {options.categories.map((account) => (
              <option key={account.id} value={account.id} data-hint={account.accountCode}>
                {account.accountName}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          label="For which job"
          htmlFor="voucher-job"
          error={errors.forJob}
          hint="Optional. Counts in that job’s cost and profit."
        >
          <NativeSelect
            id="voucher-job"
            name="forJob"
            defaultValue=""
            className="h-11 text-base md:text-sm"
          >
            <option value="">Not for one job</option>
            {options.jobs.map((job) => (
              <option key={job.value} value={job.value} data-hint={job.hint}>
                {job.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <PaymentModeField
          id="voucher-paid-by"
          modes={options.modes}
          label="Paid from"
          methodName="paymentMethod"
          accountName="paidFromAccountId"
          error={errors.paymentMethod ?? errors.paidFromAccountId}
          className="h-11 text-base md:text-sm"
        />
        <TextField
          label="Reference"
          name="paymentReference"
          id="voucher-reference"
          error={errors.paymentReference}
          hint="Optional: a transfer or cheque number."
          className={INPUT}
        />
      </div>
      <TextareaField
        label="Notes"
        name="notes"
        id="voucher-notes"
        error={errors.notes}
        className="[&_textarea]:min-h-16"
      />
      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <div className="border-t border-border pt-4">
        <SubmitButton pending={isPending} size="lg" className="h-11" pendingLabel="Saving…">
          <FileSignature />
          Pay and make voucher
        </SubmitButton>
      </div>
    </form>
  );
}

/** Withdraws a voucher entered by mistake. */
export function VoidVoucherButton({
  voucherId,
  label,
  isWork,
}: {
  voucherId: string;
  label: string;
  isWork: boolean;
}) {
  return (
    <ReasonAction
      trigger={
        <Button variant="outline" size="lg">
          <Ban />
          Void
        </Button>
      }
      title={`Void ${label}?`}
      description={
        isWork
          ? 'It stays on record, marked void, and its expense is voided with it: the money and the job’s cost go back to what they were. Its number is not reused.'
          : 'It stays on record, marked void, and its entries are reversed: the card money is no longer owed to them, and what was paid out goes back. Its number is not reused.'
      }
      placeholder="e.g. Entered twice."
      confirmLabel="Void voucher"
      successMessage={`${label} voided`}
      onConfirm={(input) => voidPaymentVoucherAction(voucherId, input)}
    />
  );
}
