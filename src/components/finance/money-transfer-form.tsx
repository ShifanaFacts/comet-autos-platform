'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRightLeft, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, FormError, NativeSelect, TextField } from '@/components/forms/fields';
import { ReferenceField } from '@/components/forms/reference-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { ReasonAction } from '@/components/shared/reason-action';
import type { ActionResult } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import { calculateLine, filsToString, toFils } from '@/lib/money';
import {
  recordMoneyTransferAction,
  voidMoneyTransferAction,
} from '@/app/(app)/finance/money/actions';

interface MoneyAccountOption {
  id: string;
  label: string;
  code: string;
  balance: string;
  /** "card-settlements": card money the bank pays in less its fee. */
  kind?: string;
}

const MONEY = /^\d{1,9}(\.\d{1,2})?$/;

/** The VAT the rate gives on a fee; '' until the fee is a valid amount. */
function vatOn(fee: string, rate: string) {
  if (!MONEY.test(fee.trim()) || !rate || Number(rate) <= 0) return '';
  return calculateLine({ quantity: '1', unitPrice: fee.trim(), taxRate: rate }).taxAmount;
}

/** What is in an account, in words for the hint under its dropdown. */
const holds = (account: MoneyAccountOption | undefined) =>
  account
    ? account.balance.startsWith('-')
      ? `Shows ${formatMoney(account.balance.slice(1))} below zero.`
      : `Holds ${formatMoney(account.balance)} now.`
    : undefined;

/**
 * Moving money between the workshop's own accounts — cash on hand into the
 * petty-cash box, the day's takings into the bank. Nothing is earned or
 * spent; the books record it as a move from one account to the other.
 *
 * Card money paid into the bank arrives less the card machine's fee: taken
 * from the card account, the form also asks what the bank kept, and the VAT
 * on it (worked out at the VAT rate; the bank statement's figure can be typed).
 */
export function MoneyTransferForm({
  accounts,
  today,
  vatRate = '',
  defaultFromId = '',
  defaultToId = '',
}: {
  accounts: MoneyAccountOption[];
  today: string;
  /** The workshop's VAT rate ("5.00"); blank when it is not VAT-registered. */
  vatRate?: string;
  defaultFromId?: string;
  defaultToId?: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [fromId, setFromId] = useState(defaultFromId);
  const [toId, setToId] = useState(defaultToId);
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState('');
  const [ownVat, setOwnVat] = useState<string | null>(null);
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await recordMoneyTransferAction(prev, formData);
      if (result.ok) {
        toast.success('Money moved');
        formRef.current?.reset();
        setFromId('');
        setToId('');
        setAmount('');
        setFee('');
        setOwnVat(null);
        router.refresh();
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};
  const from = accounts.find((account) => account.id === fromId);
  const to = accounts.find((account) => account.id === toId);
  const fromCard = from?.kind === 'card-settlements';
  const vat = ownVat ?? vatOn(fee, vatRate);
  const takenOut =
    fromCard && MONEY.test(amount.trim())
      ? filsToString(
          toFils(amount.trim()) +
            (MONEY.test(fee.trim()) ? toFils(fee.trim()) : 0) +
            (MONEY.test(vat.trim()) ? toFils(vat.trim()) : 0),
        )
      : '';
  const options = (
    <>
      <option value="" disabled>
        Choose…
      </option>
      {accounts.map((account) => (
        <option key={account.id} value={account.id} data-hint={account.code}>
          {account.label}
        </option>
      ))}
    </>
  );

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="grid gap-6 md:grid-cols-2">
        <Field
          label="Money taken from"
          htmlFor="transfer-from"
          required
          error={errors.fromAccountId}
          hint={holds(from)}
        >
          <NativeSelect
            id="transfer-from"
            name="fromAccountId"
            value={fromId}
            onChange={(event) => setFromId(event.target.value)}
            className="h-11"
          >
            {options}
          </NativeSelect>
        </Field>
        <Field
          label="Money put into"
          htmlFor="transfer-to"
          required
          error={errors.toAccountId}
          hint={holds(to)}
        >
          <NativeSelect
            id="transfer-to"
            name="toAccountId"
            value={toId}
            onChange={(event) => setToId(event.target.value)}
            className="h-11"
          >
            {options}
          </NativeSelect>
        </Field>
        <TextField
          label={fromCard ? 'Amount that arrived (AED)' : 'Amount (AED)'}
          name="amount"
          id="transfer-amount"
          numeric="money"
          required
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          error={errors.amount}
          hint={fromCard ? 'What the bank actually paid in, after its fee.' : undefined}
          className="[&_input]:h-11"
        />
        {fromCard ? (
          <>
            <TextField
              label="Kept by the bank as its fee (AED)"
              name="chargesAmount"
              id="transfer-charges"
              numeric="money"
              value={fee}
              onChange={(event) => {
                setFee(event.target.value);
                setOwnVat(null);
              }}
              error={errors.chargesAmount}
              hint="The card machine's fee on this settlement, before VAT. Booked as Bank charges."
              className="[&_input]:h-11"
            />
            <TextField
              label="VAT on the bank's fee (AED)"
              name="chargesVatAmount"
              id="transfer-charges-vat"
              numeric="money"
              value={vat}
              onChange={(event) => setOwnVat(event.target.value)}
              error={errors.chargesVatAmount}
              hint={
                takenOut
                  ? `${formatMoney(takenOut)} leaves Card payments on the way in all.`
                  : vatRate
                    ? 'Worked out from the fee. Type the bank statement’s figure if it differs.'
                    : 'As on the bank statement, if it charges VAT.'
              }
              className="[&_input]:h-11"
            />
          </>
        ) : null}
        <TextField
          label="Date"
          name="transferredOn"
          id="transfer-date"
          type="date"
          required
          defaultValue={today}
          max={today}
          error={errors.transferredOn}
          className="[&_input]:h-11"
        />
        <ReferenceField
          label="Reference"
          name="reference"
          id="transfer-reference"
          error={errors.reference}
          hint="Optional: a deposit slip, transfer or cheque number."
          className="[&_input]:h-11"
        />
        <TextField
          label="Notes"
          name="notes"
          id="transfer-notes"
          error={errors.notes}
          hint="Optional: e.g. petty-cash top-up for the week."
          className="[&_input]:h-11"
        />
      </div>
      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <div>
        <SubmitButton pending={isPending} className="h-11" pendingLabel="Moving…">
          <ArrowRightLeft />
          Move money
        </SubmitButton>
      </div>
    </form>
  );
}

/** Withdraws a transfer entered by mistake. */
export function VoidTransferButton({ transferId, label }: { transferId: string; label: string }) {
  return (
    <ReasonAction
      trigger={
        <Button variant="ghost" size="sm">
          <Ban />
          Void
        </Button>
      }
      title={`Void ${label}?`}
      description="It stays on record, marked void, and both balances go back to what they were. Its number is not reused."
      placeholder="e.g. Entered twice."
      confirmLabel="Void transfer"
      successMessage={`${label} voided`}
      onConfirm={(input) => voidMoneyTransferAction(transferId, input)}
    />
  );
}
