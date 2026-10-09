'use client';

import { useState } from 'react';
import { CheckCircle2, FileX2 } from 'lucide-react';
import { FormError, TextareaField, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { formatMoney } from '@/lib/format';
import { filsToString, toFils } from '@/lib/money';
import type { ActionResult } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { matchBillAction } from '@/app/(app)/inventory/actions';

/*
 * The supplier's tax invoice, typed as printed, beside the purchase as it
 * was recorded — each figure compared as it is typed, so a wrong quantity
 * or price shows at once. Matching is refused unless they agree (to 0.10,
 * the shop's rounding: lib/inventory/bills.ts). Or: the shop gives no tax
 * invoice, and the purchase is closed without one.
 */

const INPUT = '[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm';
const TOLERANCE = 10;

type Figure = 'subtotal' | 'taxAmount' | 'totalAmount';
const ROWS: { field: Figure; label: string }[] = [
  { field: 'subtotal', label: 'Before VAT' },
  { field: 'taxAmount', label: 'VAT' },
  { field: 'totalAmount', label: 'Total' },
];

function fils(value: string) {
  try {
    return value.trim() ? toFils(value) : null;
  } catch {
    return null;
  }
}

export function MatchBillForm({
  purchaseId,
  recorded,
  today,
  billDate,
}: {
  purchaseId: string;
  recorded: Record<Figure, string>;
  today: string;
  /** The purchase date already entered, as the bill's date to start from. */
  billDate: string;
}) {
  const [outcome, setOutcome] = useState<'RECEIVED' | 'NO_TAX_INVOICE'>('RECEIVED');
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    (prev, formData) => matchBillAction(purchaseId, prev, formData),
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};
  const [typed, setTyped] = useState<Record<Figure, string>>({
    subtotal: '',
    taxAmount: '',
    totalAmount: '',
  });

  const compared = ROWS.map((row) => {
    const bill = fils(typed[row.field]);
    const difference = bill === null ? null : bill - toFils(recorded[row.field]);
    return { ...row, bill, difference };
  });
  const complete = compared.every((row) => row.bill !== null);
  const agrees = complete && compared.every((row) => Math.abs(row.difference!) <= TOLERANCE);
  /** The bill is right and the purchase was not: correct the purchase to it. */
  const [correct, setCorrect] = useState(false);
  const correcting = complete && !agrees && correct;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <input type="hidden" name="outcome" value={outcome} />
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="What came">
        {(
          [
            ['RECEIVED', 'The tax invoice came', 'Check it against the purchase and claim its VAT.', CheckCircle2],
            ['NO_TAX_INVOICE', 'No tax invoice will come', 'The VAT can’t be claimed — it becomes part of the cost.', FileX2],
          ] as const
        ).map(([value, title, note, Icon]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={outcome === value}
            onClick={() => setOutcome(value)}
            className={cn(
              'flex items-start gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors',
              outcome === value ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted',
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{title}</span>
              <span className="text-xs text-muted-foreground">{note}</span>
            </span>
          </button>
        ))}
      </div>

      {outcome === 'RECEIVED' ? (
        <>
          <div className="grid gap-5 sm:grid-cols-3">
            <TextField
              id="bill-number"
              label="Tax invoice no."
              name="supplierInvoiceNumber"
              required
              error={errors.supplierInvoiceNumber}
              className={INPUT}
            />
            <TextField
              id="bill-date"
              label="Date on the bill"
              name="billDate"
              type="date"
              max={today}
              defaultValue={billDate}
              required
              error={errors.billDate}
              className={INPUT}
            />
            <TextField
              id="bill-received"
              label="Received on"
              name="receivedOn"
              type="date"
              max={today}
              defaultValue={today}
              required
              error={errors.receivedOn}
              hint="Its VAT is claimed in this day's VAT period."
              className={INPUT}
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                <tr>
                  <th className="px-3 py-2.5"> </th>
                  <th className="px-3 py-2.5 text-right">Recorded</th>
                  <th className="px-3 py-2.5 text-right">On the bill</th>
                  <th className="hidden px-3 py-2.5 text-right sm:table-cell">Difference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {compared.map((row) => {
                  const off = row.difference !== null && Math.abs(row.difference) > TOLERANCE;
                  return (
                    <tr key={row.field}>
                      <td className="px-3 py-2 font-medium">{row.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatMoney(recorded[row.field])}
                      </td>
                      <td className="px-3 py-2">
                        <TextField
                          id={`bill-${row.field}`}
                          label={<span className="sr-only">{row.label} on the bill</span>}
                          name={row.field}
                          numeric="money"
                          value={typed[row.field]}
                          onChange={(event) =>
                            setTyped((current) => ({ ...current, [row.field]: event.target.value }))
                          }
                          placeholder="0.00"
                          className={cn(
                            'ml-auto w-28 [&_input]:h-9 [&_input]:text-right [&_input]:tabular-nums',
                            off && '[&_input]:border-destructive',
                          )}
                        />
                      </td>
                      <td
                        className={cn(
                          'hidden px-3 py-2 text-right tabular-nums sm:table-cell',
                          off ? 'font-medium text-destructive' : 'text-muted-foreground',
                        )}
                      >
                        {row.difference === null
                          ? '—'
                          : row.difference === 0
                            ? 'Same'
                            : `${row.difference > 0 ? '+' : '−'}${filsToString(Math.abs(row.difference))}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {complete ? (
            <p className={cn('text-sm font-medium', agrees ? 'text-success' : 'text-destructive')}>
              {agrees
                ? 'The bill agrees with the purchase.'
                : 'The bill doesn’t agree with what was recorded. Check the quantity and price on the bill against the purchase lines above first.'}
            </p>
          ) : null}
          {complete && !agrees ? (
            <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm">
              <input
                type="checkbox"
                name="acceptDifference"
                value="1"
                checked={correct}
                onChange={(event) => setCorrect(event.target.checked)}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                The bill is right — correct the purchase to it
                <span className="block text-xs text-muted-foreground">
                  The difference is owed to (or by) the shop and goes to the cost of the parts; the
                  bill&apos;s VAT is claimed. Say why below.
                </span>
              </span>
            </label>
          ) : null}
          <TextareaField
            label="Note"
            name="note"
            required={correcting}
            error={errors.note}
            hint={correcting ? 'Why the bill differs — e.g. the price was guessed when bought.' : 'Optional.'}
            className="[&_textarea]:min-h-14"
          />
        </>
      ) : (
        <TextareaField
          label="Why there is no tax invoice"
          name="note"
          required
          error={errors.note}
          hint="For example: the shop isn't VAT-registered, or gave only a cash receipt."
          className="[&_textarea]:min-h-16"
        />
      )}

      <FormError message={state.error} />
      <div className="border-t border-border pt-5">
        <SubmitButton
          size="lg"
          pending={isPending}
          pendingLabel="Saving…"
          disabled={outcome === 'RECEIVED' && !agrees && !correcting}
          className="h-12 w-full sm:h-11 sm:w-auto"
        >
          {outcome === 'RECEIVED'
            ? correcting
              ? 'Correct to the bill and match'
              : 'Match tax invoice'
            : 'Close without a tax invoice'}
        </SubmitButton>
      </div>
    </form>
  );
}
