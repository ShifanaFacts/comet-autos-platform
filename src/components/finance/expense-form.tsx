'use client';

import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Field, FormError, NativeSelect, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import type { ActionResult } from '@/lib/errors';
import { recordExpenseAction } from '@/app/(app)/finance/actions';

const INPUT = '[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm';

/** Today in the workshop's own date terms, for the date field's default. */
function today() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
}

export function ExpenseForm({
  categories,
  defaultVatRate,
}: {
  categories: { id: string; accountCode: string; accountName: string }[];
  defaultVatRate: string;
}) {
  const router = useRouter();
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await recordExpenseAction(prev, formData);
      if (result.ok) {
        toast.success('Expense recorded');
        router.refresh();
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <TextField
        label="What was it for?"
        name="description"
        required
        placeholder="e.g. Monthly workshop rent — October"
        error={errors.description}
        className={INPUT}
      />

      <div className="grid gap-6 sm:grid-cols-2">
        <Field label="Category" htmlFor="categoryId" error={errors.categoryId}>
          <NativeSelect id="categoryId" name="categoryId" className="h-11 text-base md:text-sm">
            <option value="">Uncategorised</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.accountName}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <TextField
          label="Date"
          name="expenseDate"
          type="date"
          required
          defaultValue={today()}
          error={errors.expenseDate}
          className={INPUT}
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <TextField
          label="Amount excluding VAT"
          name="amount"
          inputMode="decimal"
          required
          placeholder="0.00"
          error={errors.amount}
          hint="In AED."
          className={`${INPUT} [&_input]:text-right [&_input]:tabular-nums`}
        />
        <TextField
          label="VAT rate"
          name="taxRate"
          inputMode="decimal"
          defaultValue={defaultVatRate.replace(/\.?0+$/, '')}
          error={errors.taxRate}
          hint="Leave empty if the expense carries no VAT."
          className={`${INPUT} [&_input]:text-right [&_input]:tabular-nums`}
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <TextField
          label="Paid to"
          name="vendorName"
          placeholder="e.g. Al Qusais Properties"
          error={errors.vendorName}
          className={INPUT}
        />
        <Field
          label="Paid by"
          htmlFor="paymentMethod"
          error={errors.paymentMethod}
          hint="Leave empty if it has not been paid yet."
        >
          <NativeSelect
            id="paymentMethod"
            name="paymentMethod"
            className="h-11 text-base md:text-sm"
          >
            <option value="">Not settled yet</option>
            <option value="CASH">Cash</option>
            <option value="CARD">Card</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="CHEQUE">Cheque</option>
            <option value="ONLINE">Online</option>
          </NativeSelect>
        </Field>
      </div>

      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <div className="border-t border-border pt-4">
        <SubmitButton pending={isPending} size="lg" className="h-11" pendingLabel="Recording…">
          <Plus />
          Record expense
        </SubmitButton>
      </div>
    </form>
  );
}
