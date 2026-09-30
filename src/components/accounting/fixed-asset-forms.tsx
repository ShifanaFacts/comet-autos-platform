'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, CalendarClock, LogOut, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FormError, NativeSelect, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { MoneyAccountField } from '@/components/accounting/money-account-field';
import type { AccountChoice } from '@/lib/accounting/reports';
import type { ActionResult } from '@/lib/errors';
import {
  createFixedAssetAction,
  deleteFixedAssetAction,
  disposeFixedAssetAction,
  runDepreciationAction,
} from '@/app/(app)/finance/fixed-assets/actions';

type Choice = { id: string; label: string };

const FUNDING = [
  { value: 'PAID', label: 'Paid for — from cash or bank' },
  { value: 'ON_CREDIT', label: 'Bought on credit — still owed to the supplier' },
  { value: 'OPENING', label: 'Owned before these books began' },
] as const;

function AccountSelect({
  id,
  name,
  label,
  choices,
  defaultValue,
  error,
  hint,
}: {
  id: string;
  name: string;
  label: string;
  choices: Choice[];
  defaultValue: string;
  error?: string;
  hint?: string;
}) {
  return (
    <Field label={label} htmlFor={id} required error={error} hint={hint}>
      <NativeSelect id={id} name={name} defaultValue={defaultValue} required className="h-11">
        <option value="" disabled>
          Choose…
        </option>
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.label}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}

/** Adding an asset to the register. */
export function FixedAssetForm({
  choices,
  moneyAccounts,
  today,
}: {
  choices: {
    asset: Choice[];
    accumulated: Choice[];
    expense: Choice[];
    defaults: { asset: string; accumulated: string; expense: string };
  };
  moneyAccounts: AccountChoice[];
  today: string;
}) {
  const [funding, setFunding] = useState<'PAID' | 'ON_CREDIT' | 'OPENING'>('PAID');
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    (prev, formData) => createFixedAssetAction(prev, formData),
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};
  const INPUT = '[&_input]:h-11';
  const NUMBER = `${INPUT} [&_input]:text-right [&_input]:tabular-nums`;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8">
      <fieldset className="grid gap-6 md:grid-cols-2">
        <TextField
          label="Asset"
          name="name"
          required
          error={errors.name}
          hint="e.g. Hydraulic two-post lift, Toyota Hiace recovery van."
          className={INPUT}
        />
        <TextField
          label="Serial or registration no. / notes"
          name="description"
          error={errors.description}
          className={INPUT}
        />
        <AccountSelect
          id="assetAccountId"
          name="assetAccountId"
          label="Asset account"
          choices={choices.asset}
          defaultValue={choices.defaults.asset}
          error={errors.assetAccountId}
        />
        <Field label="Bought on" htmlFor="acquiredOn" required error={errors.acquiredOn}>
          <Input
            id="acquiredOn"
            name="acquiredOn"
            type="date"
            required
            max={today}
            className="h-11"
          />
        </Field>
        <TextField
          label="Cost (AED, excluding recoverable VAT)"
          name="cost"
          required
          numeric="money"
          error={errors.cost}
          hint="Include delivery and installation."
          className={NUMBER}
        />
        <TextField
          label="Residual value (AED)"
          name="residualValue"
          numeric="money"
          defaultValue="0"
          error={errors.residualValue}
          hint="What it should fetch at the end of its life. Usually 0."
          className={NUMBER}
        />
        <TextField
          label="Useful life (months)"
          name="usefulLifeMonths"
          required
          inputMode="numeric"
          defaultValue="60"
          error={errors.usefulLifeMonths}
          hint="Equipment 60–120, vehicles 48–60, computers 36, furniture 60."
          className={NUMBER}
        />
      </fieldset>

      <fieldset className="grid gap-6 border-t border-border pt-8 md:grid-cols-2">
        <Field label="How was it paid for?" htmlFor="funding" required error={errors.funding}>
          <NativeSelect
            id="funding"
            name="funding"
            value={funding}
            onChange={(event) => setFunding(event.target.value as typeof funding)}
            className="h-11"
          >
            {FUNDING.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {funding === 'PAID' ? (
          <MoneyAccountField
            id="paidFromAccountId"
            name="paidFromAccountId"
            label="Paid from"
            accounts={moneyAccounts}
            error={errors.paidFromAccountId}
            className="h-11"
          />
        ) : null}
        {funding === 'ON_CREDIT' ? (
          <p className="self-end text-xs text-muted-foreground">
            It is owed in trade payables. When the supplier is paid, record it as a journal entry:
            Dr Trade payables, Cr the bank.
          </p>
        ) : null}
        {funding === 'OPENING' ? (
          <>
            <Field
              label="Depreciated up to"
              htmlFor="openingThrough"
              required
              error={errors.openingThrough}
              hint="The day these books take it over, e.g. the day before they began."
            >
              <Input
                id="openingThrough"
                name="openingThrough"
                type="date"
                max={today}
                className="h-11"
              />
            </Field>
            <TextField
              label="Depreciation charged up to then (AED)"
              name="openingDepreciation"
              numeric="money"
              defaultValue="0"
              error={errors.openingDepreciation}
              hint="From the previous accounts or fixed asset register."
              className={NUMBER}
            />
          </>
        ) : null}
      </fieldset>

      <fieldset className="grid gap-6 border-t border-border pt-8 md:grid-cols-2">
        <AccountSelect
          id="accumulatedAccountId"
          name="accumulatedAccountId"
          label="Accumulated depreciation account"
          choices={choices.accumulated.length ? choices.accumulated : choices.asset}
          defaultValue={choices.defaults.accumulated}
          error={errors.accumulatedAccountId}
        />
        <AccountSelect
          id="expenseAccountId"
          name="expenseAccountId"
          label="Depreciation expense account"
          choices={choices.expense}
          defaultValue={choices.defaults.expense}
          error={errors.expenseAccountId}
        />
      </fieldset>

      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <div className="border-t border-border pt-6">
        <SubmitButton pending={isPending} size="lg" className="h-11" pendingLabel="Saving…">
          <Building2 />
          Add to the register
        </SubmitButton>
      </div>
    </form>
  );
}

/** Charging depreciation on every asset up to a month. */
export function RunDepreciationForm({ month }: { month: string }) {
  const router = useRouter();
  const [state, onSubmit, isPending] = useFormAction<
    ActionResult<{ charged: number; failed: string[] }>
  >(
    async (prev, formData) => {
      const result = await runDepreciationAction(prev, formData);
      if (result.ok && result.data) {
        const { charged, failed } = result.data;
        if (failed.length)
          toast.error(`${charged} month(s) charged; ${failed.length} could not be.`);
        else
          toast.success(
            charged ? `${charged} month(s) of depreciation charged` : 'Already up to date',
          );
        router.refresh();
      }
      return result;
    },
    { ok: false },
  );
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <Field
        label="Charge depreciation up to"
        htmlFor="throughMonth"
        error={state.fieldErrors?.throughMonth}
      >
        <Input
          id="throughMonth"
          name="throughMonth"
          type="month"
          defaultValue={month}
          max={month}
          className="h-10"
        />
      </Field>
      <SubmitButton pending={isPending} className="h-10" pendingLabel="Charging…">
        <CalendarClock />
        Run depreciation
      </SubmitButton>
      {state.error ? <p className="w-full text-sm text-destructive">{state.error}</p> : null}
      {state.data?.failed.length ? (
        <ul className="w-full list-disc pl-5 text-xs text-destructive">
          {state.data.failed.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

/** Selling or scrapping an asset. */
export function DisposeAssetForm({
  assetId,
  today,
  moneyAccounts,
}: {
  assetId: string;
  today: string;
  moneyAccounts: AccountChoice[];
}) {
  const router = useRouter();
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await disposeFixedAssetAction(assetId, prev, formData);
      if (result.ok) {
        toast.success('Disposal recorded');
        router.refresh();
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="grid gap-6 md:grid-cols-3">
        <Field label="Sold or scrapped on" htmlFor="disposedOn" required error={errors.disposedOn}>
          <Input
            id="disposedOn"
            name="disposedOn"
            type="date"
            required
            max={today}
            defaultValue={today}
            className="h-11"
          />
        </Field>
        <TextField
          label="Sale proceeds (AED, excl. VAT)"
          name="proceeds"
          numeric="money"
          defaultValue="0"
          error={errors.proceeds}
          hint="0 if scrapped. Invoice the buyer separately if VAT is due on the sale."
          className="[&_input]:h-11 [&_input]:text-right [&_input]:tabular-nums"
        />
        <MoneyAccountField
          id="proceedsAccountId"
          name="proceedsAccountId"
          label="Received into"
          accounts={moneyAccounts}
          error={errors.proceedsAccountId}
          className="h-11"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Depreciation is charged up to the end of the month before, then the asset leaves the books;
        any difference between the proceeds and its book value is a gain or loss on disposal.
      </p>
      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <div>
        <SubmitButton
          pending={isPending}
          className="h-11"
          variant="outline"
          pendingLabel="Recording…"
        >
          <LogOut />
          Record disposal
        </SubmitButton>
      </div>
    </form>
  );
}

export function DeleteAssetButton({ assetId, label }: { assetId: string; label: string }) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  if (!confirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        className="h-10 text-destructive"
        onClick={() => setConfirming(true)}
      >
        <Trash2 />
        Remove
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-2 text-sm">
      {`Remove ${label}? Its entry in the books is reversed.`}
      <Button
        type="button"
        variant="destructive"
        className="h-9"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await deleteFixedAssetAction(assetId);
            if (result && !result.ok && result.error) toast.error(result.error);
          })
        }
      >
        Remove
      </Button>
      <Button type="button" variant="ghost" className="h-9" onClick={() => setConfirming(false)}>
        Keep
      </Button>
    </span>
  );
}
