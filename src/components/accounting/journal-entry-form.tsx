'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FormError, NativeSelect, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { formatMoney } from '@/lib/format';
import { filsToString, toFils } from '@/lib/money';
import type { ActionResult } from '@/lib/errors';
import { createManualEntryAction } from '@/app/(app)/finance/accounting/actions';
import { cn } from '@/lib/utils';

/*
 * A journal entry made by hand: opening balances, the owner's capital or
 * drawings, bank charges, depreciation, card takings moved to the bank, a
 * correction between accounts. It saves only when debits equal credits —
 * the server checks again, and so does the database.
 */

interface Line {
  key: number;
  accountId: string;
  debit: string;
  credit: string;
  memo: string;
}

const TYPE_LABEL: Record<string, string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  REVENUE: 'Income',
  EXPENSE: 'Expenses',
};

/** An amount as typed, in fils; 0 when blank or not a valid amount. */
function amountFils(value: string) {
  const text = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return 0;
  return toFils(text);
}

let next = 0;
const blankLine = (): Line => ({ key: next++, accountId: '', debit: '', credit: '', memo: '' });

export function JournalEntryForm({
  accounts,
  today,
}: {
  accounts: { id: string; code: string; name: string; type: string }[];
  today: string;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([blankLine(), blankLine()]);
  const [state, onSubmit, isPending] = useFormAction<ActionResult<{ entryNumber: string | null }>>(
    async (prev, formData) => {
      const result = await createManualEntryAction(prev, formData);
      if (result.ok) {
        toast.success(`Entry ${result.data?.entryNumber ?? ''} booked`);
        router.push('/finance/accounting?view=journal');
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};

  const totals = useMemo(() => {
    const debit = lines.reduce((sum, line) => sum + amountFils(line.debit), 0);
    const credit = lines.reduce((sum, line) => sum + amountFils(line.credit), 0);
    return { debit, credit, difference: debit - credit };
  }, [lines]);
  const used = lines.filter((line) => line.accountId || line.debit || line.credit);
  const ready = used.length >= 2 && totals.debit > 0 && totals.difference === 0;

  const grouped = Object.entries(TYPE_LABEL).map(([type, label]) => ({
    label,
    accounts: accounts.filter((account) => account.type === type),
  }));
  const update = (key: number, patch: Partial<Line>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const payload = JSON.stringify(
    used.map(({ accountId, debit, credit, memo }) => ({ accountId, debit, credit, memo })),
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8">
      <input type="hidden" name="lines" value={payload} />
      <div className="grid gap-6 sm:grid-cols-[12rem_1fr]">
        <Field label="Date" htmlFor="date" required error={errors.date}>
          <Input
            id="date"
            name="date"
            type="date"
            required
            max={today}
            defaultValue={today}
            className="h-11"
          />
        </Field>
        <TextField
          label="What is this entry for?"
          name="description"
          required
          error={errors.description}
          placeholder="e.g. Owner's capital paid into the bank"
          className="[&_input]:h-11"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-muted/50 text-left text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            <tr>
              <th className="px-3 py-2.5">Account</th>
              <th className="w-36 px-2 py-2.5 text-right">Debit</th>
              <th className="w-36 px-2 py-2.5 text-right">Credit</th>
              <th className="px-2 py-2.5">Note</th>
              <th className="w-12 px-2 py-2.5">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((line, index) => (
              <tr key={line.key}>
                <td className="px-3 py-2">
                  <NativeSelect
                    aria-label={`Line ${index + 1} account`}
                    value={line.accountId}
                    onChange={(event) => update(line.key, { accountId: event.target.value })}
                    className="h-9"
                  >
                    <option value="">Choose an account…</option>
                    {grouped.map((group) =>
                      group.accounts.length ? (
                        <optgroup key={group.label} label={group.label}>
                          {group.accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.code} · {account.name}
                            </option>
                          ))}
                        </optgroup>
                      ) : null,
                    )}
                  </NativeSelect>
                  {errors[`lines.${index}`] ? (
                    <p className="mt-1 text-xs text-destructive">{errors[`lines.${index}`]}</p>
                  ) : null}
                </td>
                <td className="px-2 py-2">
                  <Input
                    aria-label={`Line ${index + 1} debit`}
                    inputMode="decimal"
                    value={line.debit}
                    placeholder="0.00"
                    onChange={(event) =>
                      update(line.key, { debit: event.target.value, credit: '' })
                    }
                    className="text-right tabular-nums"
                  />
                </td>
                <td className="px-2 py-2">
                  <Input
                    aria-label={`Line ${index + 1} credit`}
                    inputMode="decimal"
                    value={line.credit}
                    placeholder="0.00"
                    onChange={(event) =>
                      update(line.key, { credit: event.target.value, debit: '' })
                    }
                    className="text-right tabular-nums"
                  />
                </td>
                <td className="px-2 py-2">
                  <Input
                    aria-label={`Line ${index + 1} note`}
                    value={line.memo}
                    onChange={(event) => update(line.key, { memo: event.target.value })}
                  />
                </td>
                <td className="px-2 py-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove line ${index + 1}`}
                    disabled={lines.length <= 2}
                    onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                  >
                    <Trash2 />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-border font-semibold">
            <tr>
              <td className="px-3 py-3">Total</td>
              <td className="px-2 py-3 text-right tabular-nums">
                {formatMoney(filsToString(totals.debit))}
              </td>
              <td className="px-2 py-3 text-right tabular-nums">
                {formatMoney(filsToString(totals.credit))}
              </td>
              <td className="px-2 py-3" colSpan={2}>
                <span
                  className={cn(
                    'text-sm',
                    totals.difference === 0 ? 'text-success' : 'text-destructive',
                  )}
                >
                  {totals.difference === 0
                    ? totals.debit > 0
                      ? 'Balanced'
                      : ''
                    : `Out by ${formatMoney(filsToString(Math.abs(totals.difference)))}`}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() => setLines((current) => [...current, blankLine()])}
      >
        <Plus />
        Add a line
      </Button>

      <FormError message={errors.lines ?? state.error} />
      <div className="border-t border-border pt-6">
        <SubmitButton pending={isPending} disabled={!ready} size="lg" pendingLabel="Booking…">
          <Save />
          Book entry
        </SubmitButton>
        <p className="mt-3 text-sm text-muted-foreground">
          A booked entry is permanent. If it turns out wrong, reverse it and book it again.
        </p>
      </div>
    </form>
  );
}
