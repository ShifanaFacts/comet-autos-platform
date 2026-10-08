'use client';

import { useMemo, useState } from 'react';
import { ClipboardCheck, Search } from 'lucide-react';
import { FormError, TextField, TextareaField } from '@/components/forms/fields';
import { NumberInput } from '@/components/forms/number-input';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { Input } from '@/components/ui/input';
import type { ActionResult } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import { filsToString, formatMilli, multiplyQuantity, milliToString } from '@/lib/money';
import { cn } from '@/lib/utils';
import { postStockCountAction } from '@/app/(app)/inventory/actions';

/*
 * The count sheet: every part with what the system holds, and a box for
 * what is really on the shelf. Only parts with a figure typed are counted;
 * the difference and what it is worth show as it is typed. Posting corrects
 * each part to its count (lib/inventory/stock-count.ts).
 */

export interface CountLine {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  unitOfMeasure: string;
  cost: string | null;
  onHandMilli: number;
}

/** Thousandths from a typed quantity, or null while it isn't one. */
function typedMilli(value: string | undefined) {
  if (!value || !/^\d+(\.\d{1,3})?$/.test(value.trim())) return null;
  return Math.round(Number(value) * 1000);
}

export function StockCountForm({ lines, today }: { lines: CountLine[]; today: string }) {
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(postStockCountAction, {
    ok: false,
  });
  const errors = state.fieldErrors ?? {};
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return lines;
    return lines.filter((line) => {
      const text = `${line.name} ${line.sku} ${line.category ?? ''}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }, [lines, query]);

  // What the count changes, in quantity and in value at cost.
  let countedParts = 0;
  let changedParts = 0;
  let valueFils = 0;
  for (const line of lines) {
    const counted = typedMilli(counts[line.id]);
    if (counted === null) continue;
    countedParts += 1;
    const difference = counted - line.onHandMilli;
    if (difference === 0) continue;
    changedParts += 1;
    if (line.cost) {
      const value = multiplyQuantity(milliToString(Math.abs(difference)), line.cost);
      valueFils += difference > 0 ? value : -value;
    }
  }
  const payload = JSON.stringify(
    Object.fromEntries(Object.entries(counts).filter(([, value]) => value.trim() !== '')),
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <input type="hidden" name="counts" value={payload} />
      <div className="grid gap-5 sm:grid-cols-[12rem_1fr]">
        <TextField
          id="count-date"
          label="Counted on"
          name="countedOn"
          type="date"
          max={today}
          defaultValue={today}
          required
          error={errors.countedOn}
          className="[&_input]:h-11"
        />
        <TextareaField
          id="count-note"
          label="Note"
          name="note"
          error={errors.note}
          hint="Optional — who counted, which shelves."
          className="[&_textarea]:min-h-11"
        />
      </div>

      <div className="relative sm:max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a part"
          aria-label="Find a part"
          className="h-11 pl-9"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            <tr>
              <th className="px-3 py-2.5">Part</th>
              <th className="w-24 px-2 py-2.5 text-right">System</th>
              <th className="w-28 px-2 py-2.5 text-right">Counted</th>
              <th className="w-24 px-2 py-2.5 text-right">Difference</th>
              <th className="hidden w-28 px-3 py-2.5 text-right sm:table-cell">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((line) => {
              const counted = typedMilli(counts[line.id]);
              const difference = counted === null ? null : counted - line.onHandMilli;
              const value =
                difference && line.cost
                  ? multiplyQuantity(milliToString(Math.abs(difference)), line.cost)
                  : 0;
              const error = errors[`counts.${line.id}`];
              return (
                <tr key={line.id} className="align-middle">
                  <td className="px-3 py-2">
                    <span className="block font-medium">{line.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      <span className="font-mono">{line.sku}</span>
                      {line.category ? ` · ${line.category}` : ''}
                      {line.cost ? ` · cost ${formatMoney(line.cost)}` : ' · no cost price'}
                    </span>
                    {error ? <span className="block text-xs text-destructive">{error}</span> : null}
                  </td>
                  <td
                    className={cn(
                      'px-2 py-2 text-right tabular-nums',
                      line.onHandMilli < 0 && 'text-destructive',
                    )}
                  >
                    {formatMilli(line.onHandMilli)}
                  </td>
                  <td className="px-2 py-2">
                    <NumberInput
                      kind="quantity"
                      aria-label={`${line.name}: counted`}
                      value={counts[line.id] ?? ''}
                      placeholder="—"
                      onChange={(event) =>
                        setCounts((current) => ({ ...current, [line.id]: event.target.value }))
                      }
                      className="ml-auto h-9 w-24 text-right tabular-nums"
                    />
                  </td>
                  <td
                    className={cn(
                      'px-2 py-2 text-right tabular-nums',
                      difference === null || difference === 0
                        ? 'text-muted-foreground'
                        : difference > 0
                          ? 'text-success'
                          : 'text-destructive',
                    )}
                  >
                    {difference === null
                      ? ''
                      : difference === 0
                        ? 'Same'
                        : `${difference > 0 ? '+' : '−'}${formatMilli(Math.abs(difference))}`}
                  </td>
                  <td className="hidden px-3 py-2 text-right text-muted-foreground tabular-nums sm:table-cell">
                    {value ? `${difference! > 0 ? '+' : '−'}${formatMoney(filsToString(value))}` : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <FormError message={state.error} />
      <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {countedParts === 0
            ? 'Type what is on the shelf for the parts you counted. Parts left blank are not touched.'
            : `${countedParts} counted · ${changedParts} to correct · ${valueFils >= 0 ? '+' : '−'}${formatMoney(filsToString(Math.abs(valueFils)))} at cost`}
        </p>
        <SubmitButton
          size="lg"
          pending={isPending}
          pendingLabel="Posting…"
          disabled={countedParts === 0}
          className="h-12 w-full sm:h-11 sm:w-auto"
        >
          <ClipboardCheck />
          Post the count
        </SubmitButton>
      </div>
    </form>
  );
}
