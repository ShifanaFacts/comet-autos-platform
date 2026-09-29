'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FormError, NativeSelect, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import type { ActionResult } from '@/lib/errors';
import type { PaymentModeRow } from '@/lib/accounting/payment-modes';
import {
  createPaymentModeAction,
  updatePaymentModeAction,
} from '@/app/(app)/finance/accounting/actions';

const INPUT = '[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm';

const METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'CARD', label: 'Card' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'ONLINE', label: 'Online' },
];

type Accounts = { id: string; label: string }[];

/** A checkbox that sends "false" when unticked, so an edit can switch a flag off. */
function Flag({
  name,
  checked,
  children,
}: {
  name: string;
  checked: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-3 text-sm">
      <input type="hidden" name={name} value="false" />
      <input
        type="checkbox"
        name={name}
        value="true"
        defaultChecked={checked}
        className="size-4 accent-primary"
      />
      {children}
    </label>
  );
}

function PaymentModeForm({
  mode,
  accounts,
  onDone,
}: {
  mode?: PaymentModeRow;
  accounts: Accounts;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = mode
        ? await updatePaymentModeAction(mode.id, prev, formData)
        : await createPaymentModeAction(prev, formData);
      if (result.ok) {
        toast.success(mode ? 'Payment mode updated' : 'Payment mode added');
        router.refresh();
        onDone?.();
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};
  const id = (name: string) => (mode ? `${name}-${mode.id}` : name);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <TextField
        label="Name"
        id={id('name')}
        name="name"
        required
        defaultValue={mode?.name}
        placeholder="e.g. ADCB current account, Card — Network, Petty cash"
        error={errors.name}
        className={INPUT}
      />
      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="Kind of payment" htmlFor={id('method')} error={errors.method}>
          <NativeSelect
            id={id('method')}
            name="method"
            defaultValue={mode?.method ?? 'BANK_TRANSFER'}
            className="h-11 text-base md:text-sm"
          >
            {METHODS.map((method) => (
              <option key={method.value} value={method.value}>
                {method.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          label="Ledger account"
          htmlFor={id('accountId')}
          error={errors.accountId}
          hint="Where the money goes in or comes out. Mark an account as a money account in the chart of accounts to see it here."
        >
          <NativeSelect
            id={id('accountId')}
            name="accountId"
            required
            defaultValue={mode?.accountId ?? ''}
            className="h-11 text-base md:text-sm"
          >
            <option value="" disabled>
              Choose…
            </option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">Use it for</legend>
        <Flag name="forReceipts" checked={mode?.forReceipts ?? true}>
          Receipts — money from customers
        </Flag>
        <Flag name="forPayments" checked={mode?.forPayments ?? true}>
          Payments — suppliers, expenses, refunds
        </Flag>
        {errors.forReceipts ? (
          <p className="text-xs text-destructive">{errors.forReceipts}</p>
        ) : null}
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <Flag name="requiresReference" checked={mode?.requiresReference ?? false}>
          A reference is required (cheque number, card slip, transfer reference)
        </Flag>
        <Flag name="isDefault" checked={mode?.isDefault ?? false}>
          The default for new receipts
        </Flag>
        {mode ? (
          <Flag name="isActive" checked={mode.isActive}>
            In use
          </Flag>
        ) : null}
        {errors.isActive ? <p className="text-xs text-destructive">{errors.isActive}</p> : null}
      </fieldset>
      <TextField
        label="Order in lists"
        id={id('sortOrder')}
        name="sortOrder"
        inputMode="numeric"
        defaultValue={String(mode?.sortOrder ?? 0)}
        error={errors.sortOrder}
        className={`${INPUT} sm:w-40`}
      />
      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <div className="border-t border-border pt-4">
        <SubmitButton pending={isPending} size="lg" className="h-11" pendingLabel="Saving…">
          {mode ? <Save /> : <Plus />}
          {mode ? 'Save changes' : 'Add payment mode'}
        </SubmitButton>
      </div>
    </form>
  );
}

export function NewPaymentModeForm({ accounts }: { accounts: Accounts }) {
  return <PaymentModeForm accounts={accounts} />;
}

export function EditPaymentModeButton({
  mode,
  accounts,
}: {
  mode: PaymentModeRow;
  accounts: Accounts;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        className="h-11 text-muted-foreground sm:h-8"
        onClick={() => setOpen(true)}
        aria-label={`Edit ${mode.name}`}
      >
        <Pencil />
        Edit
      </Button>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{mode.name}</DialogTitle>
          <DialogDescription>
            Changes apply to payments recorded from now on. Payments already recorded keep the
            account they were posted to.
          </DialogDescription>
        </DialogHeader>
        <PaymentModeForm mode={mode} accounts={accounts} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
