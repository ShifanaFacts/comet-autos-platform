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
import { createAccountAction, updateAccountAction } from '@/app/(app)/finance/accounting/actions';

const INPUT = '[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm';

export interface AccountDraft {
  id: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  isActive: boolean;
  isPaymentAccount: boolean;
  /** A system account: automatic bookings use it, so it can't be retired. */
  system: boolean;
  /** Kept per customer or per supplier. */
  subLedger: 'CUSTOMER' | 'SUPPLIER' | null;
  /** Trade receivables/payables, or already used: the sub-ledger can't change. */
  subLedgerFixed: boolean;
}

/**
 * Who the account is kept by. Kept per customer (or supplier), each journal
 * line on it names one, and the amount counts in their balance and statement.
 */
function SubLedgerField({
  id,
  defaultValue,
  fixed,
  error,
}: {
  id: string;
  defaultValue: string;
  fixed: boolean;
  error?: string;
}) {
  return (
    <Field
      label="Kept per customer or supplier"
      htmlFor={id}
      error={error}
      hint={
        fixed
          ? 'Fixed: trade receivables and payables are always kept this way, and an account with entries keeps what it was booked under.'
          : 'For receivables or payables of your own — each journal line on it then names the customer or supplier, and it counts in their balance.'
      }
    >
      <NativeSelect
        id={id}
        name="subLedger"
        defaultValue={defaultValue}
        disabled={fixed}
        className="h-11 text-base md:text-sm"
      >
        <option value="">No — one balance for the account</option>
        <option value="CUSTOMER">Per customer</option>
        <option value="SUPPLIER">Per supplier</option>
      </NativeSelect>
    </Field>
  );
}

/** Money can be received into or paid from it — offered on payment forms. */
function MoneyAccountBox({ id, defaultChecked }: { id: string; defaultChecked: boolean }) {
  return (
    <label htmlFor={id} className="flex items-start gap-3 text-sm">
      <input type="hidden" name="isPaymentAccount" value="false" />
      <input
        id={id}
        type="checkbox"
        name="isPaymentAccount"
        value="true"
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4 accent-primary"
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">Money account</span>
        <span className="text-muted-foreground">
          A cash, bank or card account: offered as where a payment goes in or comes out.
        </span>
      </span>
    </label>
  );
}

/** Adds an account, or edits one when `account` is given. */
function AccountForm({ account, onDone }: { account?: AccountDraft; onDone?: () => void }) {
  const router = useRouter();
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = account
        ? await updateAccountAction(account.id, prev, formData)
        : await createAccountAction(prev, formData);
      if (result.ok) {
        toast.success(account ? 'Account updated' : 'Account added');
        router.refresh();
        onDone?.();
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};
  const id = (name: string) => (account ? `${name}-${account.id}` : name);
  const [type, setType] = useState(account?.accountType ?? 'EXPENSE');

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="grid gap-6 sm:grid-cols-[10rem_1fr]">
        <TextField
          label="Code"
          id={id('accountCode')}
          name="accountCode"
          required
          defaultValue={account?.accountCode}
          placeholder="e.g. 5190"
          error={errors.accountCode}
          className={`${INPUT} [&_input]:font-mono`}
        />
        <TextField
          label="Name"
          id={id('accountName')}
          name="accountName"
          required
          defaultValue={account?.accountName}
          placeholder="e.g. Insurance"
          error={errors.accountName}
          className={INPUT}
        />
      </div>
      {account ? (
        <Field
          label="Status"
          htmlFor={id('isActive')}
          hint={
            account.system
              ? 'Automatic bookings use this account, so it stays in use. It can be renamed and renumbered.'
              : undefined
          }
        >
          <NativeSelect
            id={id('isActive')}
            name="isActive"
            defaultValue={String(account.isActive)}
            disabled={account.system}
            className="h-11 text-base md:text-sm"
          >
            <option value="true">In use — offered for new entries</option>
            <option value="false">Retired — kept for history only</option>
          </NativeSelect>
        </Field>
      ) : (
        <Field
          label="Kind of account"
          htmlFor="accountType"
          error={errors.accountType}
          hint="Expense accounts are the categories offered when recording an expense."
        >
          <NativeSelect
            id="accountType"
            name="accountType"
            value={type}
            onChange={(event) => setType(event.target.value)}
            className="h-11 text-base md:text-sm"
          >
            <option value="EXPENSE">Expense</option>
            <option value="REVENUE">Income</option>
            <option value="ASSET">Asset</option>
            <option value="LIABILITY">Liability</option>
            <option value="EQUITY">Equity</option>
          </NativeSelect>
        </Field>
      )}
      {type === 'ASSET' ? (
        <MoneyAccountBox
          id={id('isPaymentAccount')}
          defaultChecked={account?.isPaymentAccount ?? false}
        />
      ) : null}
      {type === 'ASSET' || type === 'LIABILITY' ? (
        <SubLedgerField
          id={id('subLedger')}
          defaultValue={account?.subLedger ?? ''}
          fixed={account?.subLedgerFixed ?? false}
          error={errors.subLedger}
        />
      ) : null}
      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <div className="border-t border-border pt-4">
        <SubmitButton pending={isPending} size="lg" className="h-11" pendingLabel="Saving…">
          {account ? <Save /> : <Plus />}
          {account ? 'Save changes' : 'Add account'}
        </SubmitButton>
      </div>
    </form>
  );
}

export function NewAccountForm() {
  return <AccountForm />;
}

export function EditAccountButton({ account }: { account: AccountDraft }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        className="h-11 text-muted-foreground sm:h-8"
        onClick={() => setOpen(true)}
        aria-label={`Edit ${account.accountName}`}
      >
        <Pencil />
        Edit
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{account.accountName}</DialogTitle>
          <DialogDescription>
            Renaming changes how it reads everywhere, including on past expenses.
          </DialogDescription>
        </DialogHeader>
        <AccountForm account={account} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
