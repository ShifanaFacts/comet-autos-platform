'use client';

import type { TaxCodeOption } from '@/lib/accounting/tax-codes';
import { NumberInput } from '@/components/forms/number-input';
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
import {
  calculateDocument,
  calculateLine,
  filsToString,
  readDiscount,
  toFils,
  type DiscountType,
  type DocumentTotals,
  type LineAmounts,
} from '@/lib/money';
import { DiscountInput } from '@/components/workshop/document-lines-editor';
import {
  ReceiptSettlementFields,
  owedHint,
  type ReceiptOptions,
} from '@/components/inventory/receipt-settlement';

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
  /** The purchase tax code chosen; blank where the rate was typed. */
  taxCodeId: string;
  /** The line's own trade discount; a blank value is none. */
  discountType: DiscountType;
  discountValue: string;
}

/**
 * The code a line starts on: its own; else the standard code at its rate
 * (zero-rated when it carries none); else the default.
 */
function codeFor(codes: TaxCodeOption[], taxCodeId: string | undefined, taxRate: string) {
  if (!codes.length) return null;
  if (taxCodeId) return codes.find((code) => code.id === taxCodeId) ?? null;
  const rate = Number(taxRate || 0);
  return (
    (rate > 0
      ? codes.find((code) => code.treatment === 'STANDARD' && Number(code.rate) === rate)
      : codes.find((code) => code.treatment === 'ZERO_RATED')) ??
    codes.find((code) => code.isDefault) ??
    codes[0]
  );
}

export interface PurchaseFormInitial {
  supplierId: string;
  supplierInvoiceNumber: string;
  supplierInvoiceDate: string;
  notes: string;
  /** The discount on the whole bill, as entered. */
  billDiscountType?: DiscountType | null;
  billDiscountValue?: string;
  dueDate?: string;
  items: {
    partId: string;
    quantity: string;
    unitCost: string;
    taxRate: string;
    taxCodeId?: string | null;
    discountType?: DiscountType | null;
    discountValue?: string;
  }[];
}

/** Preview only — the server recalculates every amount when the purchase is saved. */
function preview(line: Line): LineAmounts | null {
  try {
    return calculateLine({
      quantity: line.quantity,
      unitPrice: line.unitCost,
      taxRate: line.taxRate || '0',
      discount: readDiscount(line.discountType, line.discountValue),
    });
  } catch {
    return null;
  }
}

/** Quantity × cost before any discount, for the "lines" total. */
function gross(line: Line): number {
  try {
    return calculateLine({ quantity: line.quantity, unitPrice: line.unitCost, taxRate: '0' })
      .lineTotalFils;
  } catch {
    return 0;
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
  taxCodes = [],
  hidden = {},
  receipt,
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
  /** The purchase tax codes. Given, each line picks a code instead of typing a rate. */
  taxCodes?: TaxCodeOption[];
  /** Extra values sent with the form (Scan bill marks what the reader filled). */
  hidden?: Record<string, string>;
  /** Paying the supplier as the goods are received ("Save & receive stock"). */
  receipt?: ReceiptOptions;
}) {
  const nextKey = useRef(initial?.items.length ?? 0);
  const intentRef = useRef<HTMLInputElement>(null);
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? '');
  const [lines, setLines] = useState<Line[]>(() =>
    (initial?.items ?? []).map((item, index) => {
      const code = codeFor(taxCodes, item.taxCodeId ?? undefined, item.taxRate);
      return {
        key: index,
        ...item,
        taxRate: code ? code.rate : item.taxRate,
        taxCodeId: code?.id ?? '',
        discountType: item.discountType ?? 'PERCENT',
        discountValue: item.discountValue ?? '',
      };
    }),
  );
  const [bill, setBill] = useState<{ type: DiscountType; value: string }>({
    type: initial?.billDiscountType ?? 'PERCENT',
    value: initial?.billDiscountValue ?? '',
  });
  const [payment, setPayment] = useState<'later' | 'now'>('later');
  const [payAmount, setPayAmount] = useState<string | null>(null);
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
        discountType: 'PERCENT',
        discountValue: '',
        ...(() => {
          const code = codeFor(taxCodes, undefined, part.taxRate || defaultVat);
          return code
            ? { taxRate: code.rate, taxCodeId: code.id }
            : { taxRate: part.taxRate || defaultVat, taxCodeId: '' };
        })(),
      },
    ]);
    setSearch('');
  }
  const update = (key: number, change: Partial<Line>) =>
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...change } : line)),
    );

  const amounts = lines.map(preview);
  let totals: DocumentTotals | null = null;
  let billError: string | null = null;
  if (amounts.every(Boolean) && amounts.length > 0) {
    try {
      totals = calculateDocument(
        amounts as LineAmounts[],
        readDiscount(bill.type, bill.value),
      ).totals;
    } catch (error) {
      billError = error instanceof Error ? error.message : 'Check the discount.';
    }
  }
  const grossFils = lines.reduce((sum, line) => sum + gross(line), 0);
  const discountFils = totals ? grossFils - toFils(totals.subtotal) : 0;
  const payload = JSON.stringify(
    lines.map(({ partId, quantity, unitCost, taxRate, taxCodeId, discountType, discountValue }) => ({
      partId,
      quantity,
      unitCost,
      taxRate,
      taxCodeId,
      discountType: discountValue.trim() ? discountType : '',
      discountValue: discountValue.trim(),
    })),
  );
  const lineError = (index: number) =>
    Object.entries(errors).find(([key]) => key.startsWith(`items.${index}.`))?.[1];

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8">
      <input type="hidden" name="items" value={payload} />
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input ref={intentRef} type="hidden" name="intent" defaultValue="draft" />
      <input type="hidden" name="billDiscountType" value={bill.value.trim() ? bill.type : ''} />
      <input type="hidden" name="billDiscountValue" value={bill.value.trim()} />

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
        <TextField
          label="Due date"
          name="dueDate"
          type="date"
          defaultValue={initial?.dueDate}
          error={errors.dueDate}
          hint="Optional: when the supplier expects to be paid."
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
                  <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_1fr_auto_0.8fr_auto] lg:w-[40rem]">
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      Qty ({part?.unit})
                      <NumberInput kind="quantity"
                        value={line.quantity}
                        onChange={(event) => update(line.key, { quantity: event.target.value })}
                        className="h-11 text-right text-base tabular-nums md:text-sm"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      Unit cost
                      <NumberInput
                        value={line.unitCost}
                        onChange={(event) => update(line.key, { unitCost: event.target.value })}
                        className="h-11 text-right text-base tabular-nums md:text-sm"
                      />
                    </label>
                    <span className="flex flex-col gap-1 text-xs text-muted-foreground">
                      Discount
                      <DiscountInput
                        label={`${part?.sku ?? 'Line'} discount`}
                        type={line.discountType}
                        value={line.discountValue}
                        large
                        onChange={(discount) =>
                          update(line.key, {
                            discountType: discount.type,
                            discountValue: discount.value,
                          })
                        }
                      />
                    </span>
                    {taxCodes.length ? (
                      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                        Tax code
                        <NativeSelect
                          value={line.taxCodeId}
                          onChange={(event) => {
                            const code = taxCodes.find((c) => c.id === event.target.value);
                            if (code) update(line.key, { taxCodeId: code.id, taxRate: code.rate });
                          }}
                          className="h-11 text-base md:text-sm"
                        >
                          {taxCodes.map((code) => (
                            <option key={code.id} value={code.id}>
                              {code.code}
                              {code.treatment === 'STANDARD'
                                ? ` ${code.rate.replace(/\.?0+$/, '')}%`
                                : ''}
                            </option>
                          ))}
                        </NativeSelect>
                      </label>
                    ) : (
                      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                        VAT %
                        <NumberInput
                          kind="rate"
                          value={line.taxRate}
                          onChange={(event) => update(line.key, { taxRate: event.target.value })}
                          className="h-11 text-right text-base tabular-nums md:text-sm"
                        />
                      </label>
                    )}
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
                    {amount && toFils(amount.discountAmount) > 0 ? (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {`−${formatMoney(amount.discountAmount)} discount`}
                      </span>
                    ) : null}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {errors.items ? <p className="text-sm text-destructive">{errors.items}</p> : null}

        {lines.length > 0 ? (
          <dl className="ml-auto grid w-full max-w-sm grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Lines subtotal</dt>
            <dd className="text-right tabular-nums">{formatMoney(filsToString(grossFils))}</dd>
            <dt className="text-muted-foreground">Discount on the whole bill</dt>
            <dd className="flex justify-end">
              <DiscountInput
                label="Discount on the whole bill"
                type={bill.type}
                value={bill.value}
                onChange={setBill}
              />
            </dd>
            {billError || errors.billDiscountValue ? (
              <p role="alert" className="col-span-2 text-right text-xs text-destructive">
                {billError ?? errors.billDiscountValue}
              </p>
            ) : null}
            {totals ? (
              <>
                <dt className="text-muted-foreground">Discount</dt>
                <dd className="text-right tabular-nums">
                  {discountFils > 0 ? `−${formatMoney(filsToString(discountFils))}` : '—'}
                </dd>
                <dt className="text-muted-foreground">Subtotal after discount</dt>
                <dd className="text-right tabular-nums">{formatMoney(totals.subtotal)}</dd>
                <dt className="text-muted-foreground">VAT</dt>
                <dd className="text-right tabular-nums">{formatMoney(totals.taxAmount)}</dd>
                <dt className="border-t border-border pt-1.5 font-semibold">Grand total</dt>
                <dd className="border-t border-border pt-1.5 text-right font-semibold tabular-nums">
                  {formatMoney(totals.totalAmount)}
                </dd>
              </>
            ) : null}
          </dl>
        ) : null}
        {totals && discountFils > 0 ? (
          <p className="text-right text-xs text-muted-foreground">
            A supplier discount lowers what the parts cost you and the VAT you can claim back. It
            is not income.
          </p>
        ) : null}
      </div>

      <TextareaField
        label="Notes"
        name="notes"
        defaultValue={initial?.notes}
        error={errors.notes}
        className="[&_textarea]:min-h-16"
      />
      {isNew && canReceive && receipt ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Used when you choose “Save & receive stock”.
          </p>
          <ReceiptSettlementFields
            options={receipt}
            errors={errors}
            showDueDate={false}
            amount={payAmount ?? totals?.totalAmount ?? ''}
            onAmountChange={setPayAmount}
            amountHint={owedHint(totals?.totalAmount ?? null)}
            onPaymentChange={setPayment}
            idPrefix="new-purchase"
          />
        </div>
      ) : null}

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
              // A draft has received nothing, so there is nothing to pay yet.
              disabled={isPending || payment === 'now'}
              title={payment === 'now' ? 'Choose “Pay later” to save a draft.' : undefined}
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
