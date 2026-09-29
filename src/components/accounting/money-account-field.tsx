import { Field, NativeSelect } from '@/components/forms/fields';
import type { AccountChoice } from '@/lib/accounting/reports';

/*
 * Which cash, bank or card account money went into or came out of. Left on
 * the default, the books use the usual account for the payment method: cash
 * to Cash on hand, card to Card settlements receivable, the rest to Bank.
 */
export function MoneyAccountField({
  id,
  name,
  label,
  accounts,
  defaultValue = '',
  value,
  onChange,
  error,
  className = 'h-12 text-base md:h-11 md:text-sm',
}: {
  id: string;
  name?: string;
  label: string;
  accounts: AccountChoice[];
  defaultValue?: string;
  /** Controlled use, when the form keeps its own state. */
  value?: string;
  onChange?: (accountId: string) => void;
  error?: string;
  className?: string;
}) {
  return (
    <Field
      label={label}
      htmlFor={id}
      error={error}
      hint="Leave on the default unless the money went somewhere else."
    >
      <NativeSelect
        id={id}
        name={name}
        {...(value !== undefined
          ? { value, onChange: (event) => onChange?.(event.target.value) }
          : { defaultValue })}
        className={className}
      >
        <option value="">Default for the payment method</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.code} · {account.name}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}
