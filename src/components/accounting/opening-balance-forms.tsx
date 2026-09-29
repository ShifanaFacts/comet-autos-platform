'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormError, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { ReasonAction } from '@/components/shared/reason-action';
import { CustomerPicker, type PickedParty } from '@/components/workshop/customer-picker';
import type { ActionResult } from '@/lib/errors';
import type { OpeningBalances } from '@/lib/accounting/opening-balances';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  addCustomerOpeningBalanceAction,
  removeCustomerOpeningBalanceAction,
  saveOpeningBalancesAction,
} from '@/app/(app)/finance/accounting/actions';

const TYPE_LABEL: Record<string, string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
};

/** Fils from what was typed; anything unreadable counts as nothing. */
function fils(text: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return 0;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

const money = (value: number) => formatMoney((value / 100).toFixed(2));

/**
 * The general accounts' opening trial balance: a debit or a credit per
 * account, with live totals and the difference that will go to opening
 * balance equity.
 */
export function OpeningBalancesForm({
  rows,
  date,
  suggestedDate,
  locked,
}: {
  rows: OpeningBalances['rows'];
  date: string | null;
  suggestedDate: string;
  /** The date can't move while customer opening balances hold it. */
  locked: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, { debit: string; credit: string }>>(() =>
    Object.fromEntries(rows.map((row) => [row.id, { debit: row.debit, credit: row.credit }])),
  );
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await saveOpeningBalancesAction(prev, formData);
      if (result.ok) {
        toast.success('Opening balances saved');
        router.refresh();
      }
      return result;
    },
    { ok: false },
  );

  const editable = rows.filter((row) => !row.managed);
  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const row of editable) {
      debit += fils(values[row.id]?.debit ?? '');
      credit += fils(values[row.id]?.credit ?? '');
    }
    return { debit, credit, difference: debit - credit };
  }, [values, editable]);

  const payload = JSON.stringify(
    editable
      .map((row) => ({
        accountId: row.id,
        debit: values[row.id]?.debit.trim() ?? '',
        credit: values[row.id]?.credit.trim() ?? '',
      }))
      .filter((line) => line.debit || line.credit),
  );
  const set = (id: string, side: 'debit' | 'credit', value: string) =>
    setValues((current) => ({
      ...current,
      [id]: { ...(current[id] ?? { debit: '', credit: '' }), [side]: value },
    }));
  const groups = ['ASSET', 'LIABILITY', 'EQUITY'].map((type) => ({
    type,
    rows: rows.filter((row) => row.type === type),
  }));

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <input type="hidden" name="lines" value={payload} />
      <TextField
        label="Opening date"
        name="date"
        type="date"
        required
        defaultValue={date ?? suggestedDate}
        readOnly={locked}
        hint={
          locked
            ? 'Fixed while customer opening balances are dated on it.'
            : 'The day before the first transaction in these books — usually the last day of the previous financial year.'
        }
        error={state.fieldErrors?.date}
        className="sm:w-64 [&_input]:h-11"
      />

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-muted/40 text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
            <tr>
              <th className="w-20 px-4 py-3">Code</th>
              <th className="px-2 py-3">Account</th>
              <th className="w-36 px-2 py-3 text-right">Debit</th>
              <th className="w-36 px-4 py-3 text-right">Credit</th>
            </tr>
          </thead>
          {groups.map((group) =>
            group.rows.length ? (
              <tbody key={group.type} className="divide-y divide-border border-t border-border">
                <tr className="bg-muted/20">
                  <td colSpan={4} className="px-4 py-2 text-xs font-semibold">
                    {TYPE_LABEL[group.type]}
                  </td>
                </tr>
                {group.rows.map((row) => (
                  <tr key={row.id} className={cn(row.managed && 'text-muted-foreground')}>
                    <td className="px-4 py-2 font-mono text-xs">{row.code}</td>
                    <td className="px-2 py-2">
                      {row.name}
                      {row.managed ? <span className="block text-xs">{row.managed}</span> : null}
                    </td>
                    {row.managed ? (
                      <td colSpan={2} className="px-4 py-2 text-right text-xs">
                        —
                      </td>
                    ) : (
                      <>
                        <td className="px-2 py-1.5">
                          <Input
                            inputMode="decimal"
                            aria-label={`${row.name} debit`}
                            value={values[row.id]?.debit ?? ''}
                            onChange={(event) => set(row.id, 'debit', event.target.value)}
                            className="h-9 text-right tabular-nums"
                          />
                        </td>
                        <td className="px-4 py-1.5">
                          <Input
                            inputMode="decimal"
                            aria-label={`${row.name} credit`}
                            value={values[row.id]?.credit ?? ''}
                            onChange={(event) => set(row.id, 'credit', event.target.value)}
                            className="h-9 text-right tabular-nums"
                          />
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            ) : null,
          )}
          <tfoot className="border-t-2 border-border bg-muted/40 font-semibold">
            <tr>
              <td colSpan={2} className="px-4 py-3">
                Total
              </td>
              <td className="px-2 py-3 text-right tabular-nums">{money(totals.debit)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{money(totals.credit)}</td>
            </tr>
            {totals.difference !== 0 ? (
              <tr className="font-normal text-muted-foreground">
                <td colSpan={2} className="px-4 pb-3 text-xs">
                  Difference, booked to Opening balance equity
                </td>
                <td className="px-2 pb-3 text-right tabular-nums">
                  {totals.difference < 0 ? money(-totals.difference) : ''}
                </td>
                <td className="px-4 pb-3 text-right tabular-nums">
                  {totals.difference > 0 ? money(totals.difference) : ''}
                </td>
              </tr>
            ) : null}
          </tfoot>
        </table>
      </div>

      <FormError message={state.fieldErrors?.date ? undefined : state.error} />
      <div>
        <SubmitButton pending={isPending} size="lg" className="h-11" pendingLabel="Saving…">
          <Save />
          Save opening balances
        </SubmitButton>
      </div>
    </form>
  );
}

/** Adds what one customer owed on the opening date. */
export function CustomerOpeningForm({ openingDate }: { openingDate: string }) {
  const router = useRouter();
  const [picked, setPicked] = useState<PickedParty | null>(null);
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await addCustomerOpeningBalanceAction(prev, formData);
      if (result.ok) {
        toast.success('Customer opening balance added');
        setPicked(null);
        router.refresh();
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <input type="hidden" name="customerId" value={picked?.customer.id ?? ''} />
      <CustomerPicker value={picked} onChange={setPicked} allowJobCard={false} />
      {picked ? (
        <>
          <div className="grid gap-6 sm:grid-cols-3">
            <TextField
              label="Amount owed"
              name="amount"
              inputMode="decimal"
              required
              placeholder="0.00"
              hint={`As on ${openingDate}, VAT included.`}
              error={errors.amount}
              className="[&_input]:h-11 [&_input]:text-right [&_input]:tabular-nums"
            />
            <TextField
              label="Due date"
              name="dueDate"
              type="date"
              hint="For ageing. Leave empty to age from the opening date."
              error={errors.dueDate}
              className="[&_input]:h-11"
            />
            <TextField
              label="Reference"
              name="reference"
              placeholder="e.g. old invoice numbers"
              error={errors.reference}
              className="[&_input]:h-11"
            />
          </div>
          <FormError message={Object.keys(errors).length ? undefined : state.error} />
          <div>
            <SubmitButton pending={isPending} size="lg" className="h-11" pendingLabel="Adding…">
              <Plus />
              Add opening balance
            </SubmitButton>
          </div>
        </>
      ) : (
        <FormError message={errors.customerId ?? state.error} />
      )}
    </form>
  );
}

export function RemoveCustomerOpeningButton({
  invoiceId,
  label,
}: {
  invoiceId: string;
  label: string;
}) {
  return (
    <ReasonAction
      trigger={
        <Button variant="ghost" size="sm" className="h-11 text-muted-foreground sm:h-8">
          <Trash2 />
          Remove
        </Button>
      }
      title={`Remove ${label}?`}
      description="The opening balance is voided and taken out of the books. Not possible once a receipt has been recorded against it."
      confirmLabel="Remove"
      placeholder="e.g. Entered the wrong amount"
      successMessage="Opening balance removed"
      onConfirm={(input) => removeCustomerOpeningBalanceAction(invoiceId, input)}
    />
  );
}
