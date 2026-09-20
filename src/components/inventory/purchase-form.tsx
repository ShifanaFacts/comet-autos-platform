'use client';

import { useMemo, useRef, useState } from 'react';
import { PackageCheck, Plus, Save, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Field,
  FormError,
  NativeSelect,
  TextField,
  TextareaField,
} from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { LinkButton } from '@/components/shared/link-button';
import type { ActionResult } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import { calculateLine, calculateTotals, type LineAmounts } from '@/lib/money';

export interface PurchasePart {
  id: string;
  sku: string;
  name: string;
  unit: string;
  cost: string;
  taxRate: string;
  supplierId: string | null;
}

interface Line {
  key: number;
  partId: string;
  quantity: string;
  unitCost: string;
  taxRate: string;
}

export interface PurchaseFormInitial {
  supplierId: string;
  supplierInvoiceNumber: string;
  supplierInvoiceDate: string;
  notes: string;
  items: { partId: string; quantity: string; unitCost: string; taxRate: string }[];
}

/** Preview only — the server recalculates every amount when the purchase is saved. */
function preview(line: Line): LineAmounts | null {
  try {
    return calculateLine({
      quantity: line.quantity,
      unitPrice: line.unitCost,
      taxRate: line.taxRate || '0',
    });
  } catch {
    return null;
  }
}

export function PurchaseForm({
  action,
  parts,
  suppliers,
  defaultVat,
  today,
  initial,
  isNew,
  canReceive,
  cancelHref,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  parts: PurchasePart[];
  suppliers: { id: string; name: string }[];
  defaultVat: string;
  today: string;
  initial?: PurchaseFormInitial;
  isNew: boolean;
  canReceive: boolean;
  cancelHref: string;
}) {
  const nextKey = useRef(initial?.items.length ?? 0);
  const intentRef = useRef<HTMLInputElement>(null);
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? '');
  const [lines, setLines] = useState<Line[]>(() =>
    (initial?.items ?? []).map((item, index) => ({ key: index, ...item })),
  );
  const [search, setSearch] = useState('');
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(action, { ok: false });
  const errors = state.fieldErrors ?? {};
  const byId = useMemo(() => new Map(parts.map((part) => [part.id, part])), [parts]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const taken = new Set(lines.map((line) => line.partId));
    return parts
      .filter(
        (part) =>
          !taken.has(part.id) &&
          (part.sku.toLowerCase().includes(q) || part.name.toLowerCase().includes(q)),
      )
      .sort((a, b) => Number(b.supplierId === supplierId) - Number(a.supplierId === supplierId))
      .slice(0, 8);
  }, [search, parts, lines, supplierId]);

  function addPart(part: PurchasePart) {
    setLines((current) => [
      ...current,
      {
        key: nextKey.current++,
        partId: part.id,
        quantity: '1',
        unitCost: part.cost,
        taxRate: part.taxRate || defaultVat,
      },
    ]);
    setSearch('');
  }
  const update = (key: number, change: Partial<Line>) =>
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...change } : line)),
    );

  const amounts = lines.map(preview);
  const totals =
    amounts.every(Boolean) && amounts.length > 0 ? calculateTotals(amounts as LineAmounts[]) : null;
  const payload = JSON.stringify(
    lines.map(({ partId, quantity, unitCost, taxRate }) => ({
      partId,
      quantity,
      unitCost,
      taxRate,
    })),
  );
  const lineError = (index: number) =>
    Object.entries(errors).find(([key]) => key.startsWith(`items.${index}.`))?.[1];

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8">
      <input type="hidden" name="items" value={payload} />
      <input ref={intentRef} type="hidden" name="intent" defaultValue="draft" />

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Supplier"
          htmlFor="supplierId"
          required
          error={errors.supplierId}
          className="lg:col-span-2"
        >
          <NativeSelect
            id="supplierId"
            name="supplierId"
            required
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
            className="h-11 text-base md:text-sm"
          >
            <option value="">Choose the supplier…</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <TextField
          label="Supplier invoice no."
          name="supplierInvoiceNumber"
          defaultValue={initial?.supplierInvoiceNumber}
          error={errors.supplierInvoiceNumber}
          hint="Their invoice or delivery note."
          className="[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm"
        />
        <TextField
          label="Purchase date"
          name="supplierInvoiceDate"
          type="date"
          max={today}
          defaultValue={initial?.supplierInvoiceDate ?? today}
          error={errors.supplierInvoiceDate}
          className="[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm"
        />
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">Parts received</p>
          <div className="relative w-full sm:max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (matches[0]) addPart(matches[0]);
                }
              }}
              placeholder="Add a part — type SKU or name"
              aria-label="Add a part"
              className="h-11 pl-9 text-base md:text-sm"
            />
            {matches.length > 0 ? (
              <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-md">
                {matches.map((part) => (
                  <li key={part.id}>
                    <button
                      type="button"
                      onClick={() => addPart(part)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{part.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">{part.sku}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        {part.cost ? formatMoney(part.cost) : 'no cost'}
                        <Plus className="size-4" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : search.trim() ? (
              <p className="mt-2 text-xs text-muted-foreground">
                No active part matches. Add it to the catalogue first.
              </p>
            ) : null}
          </div>
        </div>

        {lines.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No parts yet. Search above to add the first line.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {lines.map((line, index) => {
              const part = byId.get(line.partId);
              const amount = amounts[index];
              const error = lineError(index);
              return (
                <li key={line.key} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                  <div className="min-w-0 lg:flex-1">
                    <p className="truncate font-medium">{part?.name ?? 'Unknown part'}</p>
                    <p className="font-mono text-xs text-muted-foreground">{part?.sku}</p>
                    {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
                  </div>
                  <div className="grid grid-cols-[1fr_1fr_0.7fr_auto] items-end gap-2 lg:w-[30rem]">
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      Qty ({part?.unit})
                      <Input
                        value={line.quantity}
                        inputMode="decimal"
                        onChange={(event) => update(line.key, { quantity: event.target.value })}
                        className="h-11 text-right text-base tabular-nums md:text-sm"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      Unit cost
                      <Input
                        value={line.unitCost}
                        inputMode="decimal"
                        onChange={(event) => update(line.key, { unitCost: event.target.value })}
                        className="h-11 text-right text-base tabular-nums md:text-sm"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      VAT %
                      <Input
                        value={line.taxRate}
                        inputMode="decimal"
                        onChange={(event) => update(line.key, { taxRate: event.target.value })}
                        className="h-11 text-right text-base tabular-nums md:text-sm"
                      />
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 text-muted-foreground"
                      aria-label={`Remove ${part?.sku}`}
                      onClick={() =>
                        setLines((current) => current.filter((l) => l.key !== line.key))
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <p className="text-right text-sm font-medium tabular-nums lg:w-28">
                    {amount ? formatMoney(amount.lineTotal) : '—'}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {errors.items ? <p className="text-sm text-destructive">{errors.items}</p> : null}

        {totals ? (
          <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="text-right tabular-nums">{formatMoney(totals.subtotal)}</dd>
            <dt className="text-muted-foreground">VAT</dt>
            <dd className="text-right tabular-nums">{formatMoney(totals.taxAmount)}</dd>
            <dt className="border-t border-border pt-1.5 font-semibold">Total</dt>
            <dd className="border-t border-border pt-1.5 text-right font-semibold tabular-nums">
              {formatMoney(totals.totalAmount)}
            </dd>
          </dl>
        ) : null}
      </div>

      <TextareaField
        label="Notes"
        name="notes"
        defaultValue={initial?.notes}
        error={errors.notes}
        className="[&_textarea]:min-h-16"
      />
      <FormError message={Object.keys(errors).length ? undefined : state.error} />

      <div className="flex flex-wrap gap-3 border-t border-border pt-6">
        {!isNew ? (
          <SubmitButton pending={isPending} size="lg" className="h-11" pendingLabel="Saving…">
            <Save />
            Save changes
          </SubmitButton>
        ) : (
          <>
            {canReceive ? (
              <SubmitButton
                pending={isPending}
                size="lg"
                className="h-11"
                pendingLabel="Saving…"
                onClick={() => intentRef.current && (intentRef.current.value = 'receive')}
              >
                <PackageCheck />
                Save & receive stock
              </SubmitButton>
            ) : null}
            <Button
              type="submit"
              variant="outline"
              size="lg"
              className="h-11"
              disabled={isPending}
              onClick={() => intentRef.current && (intentRef.current.value = 'draft')}
            >
              <Save />
              Save as draft
            </Button>
          </>
        )}
        <LinkButton href={cancelHref} variant="ghost" size="lg" className="h-11">
          Cancel
        </LinkButton>
      </div>
    </form>
  );
}
