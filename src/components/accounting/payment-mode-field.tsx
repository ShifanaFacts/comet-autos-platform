'use client';

import { useState } from 'react';
import { Field, NativeSelect } from '@/components/forms/fields';
import type { PaymentModeOption } from '@/lib/accounting/payment-modes';

/*
 * How money was received or paid, chosen from the payment mode master. The
 * mode decides two things the server already understands — the payment
 * method and the ledger account — so they go as hidden fields under the
 * names each form has always used. Nothing on the server has to know modes
 * exist, and every rule it checks still applies.
 */
export function PaymentModeField({
  id,
  modes,
  label = 'Payment mode',
  methodName = 'method',
  accountName = 'accountId',
  defaultModeId,
  unsettledLabel,
  error,
  onChange,
  className = 'h-12 text-base md:h-11 md:text-sm',
}: {
  id: string;
  modes: PaymentModeOption[];
  label?: string;
  /** The form field the payment method goes in. */
  methodName?: string;
  /** The form field the account goes in. */
  accountName?: string;
  defaultModeId?: string;
  /** Offer "not paid yet" (an expense on credit): method and account go blank. */
  unsettledLabel?: string;
  error?: string;
  /** The mode chosen, e.g. to require a reference number. */
  onChange?: (mode: PaymentModeOption | null) => void;
  className?: string;
}) {
  const [modeId, setModeId] = useState(
    defaultModeId ??
      (unsettledLabel ? '' : ((modes.find((mode) => mode.isDefault) ?? modes[0])?.id ?? '')),
  );
  const mode = modes.find((option) => option.id === modeId) ?? null;

  return (
    <Field
      label={label}
      htmlFor={id}
      error={error}
      hint={mode ? `Posted to ${mode.accountName}.` : undefined}
    >
      <input type="hidden" name={methodName} value={mode?.method ?? ''} />
      <input type="hidden" name={accountName} value={mode?.accountId ?? ''} />
      <NativeSelect
        id={id}
        value={modeId}
        onChange={(event) => {
          setModeId(event.target.value);
          onChange?.(modes.find((option) => option.id === event.target.value) ?? null);
        }}
        className={className}
      >
        {unsettledLabel ? <option value="">{unsettledLabel}</option> : null}
        {modes.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}

/**
 * The mode matching a record saved before (its method and account), for a
 * form that corrects it: the one on the same account with the same method,
 * else any on the same method.
 */
export function modeFor(
  modes: PaymentModeOption[],
  method: string | null | undefined,
  accountId: string | null | undefined,
) {
  if (!method) return '';
  return (
    modes.find((mode) => mode.method === method && mode.accountId === accountId)?.id ??
    modes.find((mode) => mode.method === method)?.id ??
    ''
  );
}
