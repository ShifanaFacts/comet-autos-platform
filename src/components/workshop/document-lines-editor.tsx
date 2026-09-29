'use client';

import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { Package, Plus, Trash2, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  calculateDocument,
  calculateLine,
  formatMilli,
  readDiscount,
  signedToMilli,
  toFils,
  type DiscountType,
  type DocumentTotals,
  type LineAmounts,
} from '@/lib/money';
import { formatMoney } from '@/lib/format';
import type { BillDiscount, EditableLine, LineType } from '@/lib/billing/editable-lines';
import { rateFor, VAT_TREATMENTS, type VatTreatment } from '@/lib/vat-treatment';
import type { TaxCodeOption } from '@/lib/accounting/tax-codes';
import { cn } from '@/lib/utils';

/*
 * Typing the lines of a quotation or an invoice, laid out like the
 * workshop's own sheet: one numbered list, each line marked Parts or
 * Labour, then Qty, Price, Discount and Amount, with the totals — and a
 * discount on the whole bill — underneath.
 *
 * Every figure shown while typing comes from lib/money — the same rules the
 * server prices with — so the total on screen is the total on the document.
 * The server still prices every line again; nothing here is trusted.
 */

export type { BillDiscount, EditableLine, LineType };

export const NO_BILL_DISCOUNT: BillDiscount = { type: 'PERCENT', value: '' };

/** "5.00" → "5" for the rate input. */
export const trimRate = (rate: string) => (rate.includes('.') ? rate.replace(/\.?0+$/, '') : rate);

let counter = 0;
export function newEditableLine(
  itemType: LineType,
  defaultVatRate: string,
  /** The workshop's default tax code, when it keeps a tax code master. */
  taxCode?: TaxCodeOption | null,
): EditableLine {
  counter += 1;
  return {
    key: `line-${Date.now()}-${counter}`,
    itemType,
    description: '',
    quantity: '1',
    unitPrice: '',
    taxRate: trimRate(taxCode?.rate ?? defaultVatRate),
    vatTreatment: taxCode?.treatment ?? 'STANDARD',
    taxCodeId: taxCode?.id ?? '',
    discountType: 'PERCENT',
    discount: '',
    accountId: '',
  };
}

/** The lines as the server expects them — blank lines left out. */
export function linesPayload(lines: EditableLine[]) {
  return lines
    .filter((line) => !isBlankLine(line))
    .map(
      ({
        itemType,
        description,
        quantity,
        unitPrice,
        vatTreatment,
        taxCodeId,
        discountType,
        discount,
        accountId,
      }) => ({
        itemType,
        description,
        quantity,
        unitPrice,
        vatTreatment,
        taxCodeId,
        discountType,
        discount,
        accountId,
      }),
    );
}

/** The bill discount as the server expects it. */
export function billDiscountPayload(bill: BillDiscount) {
  return { discountType: bill.type, discount: bill.value };
}

/** The rate a line is priced at: its tax code's, else its treatment's. */
const lineRate = (line: EditableLine, defaultVatRate: string) =>
  line.taxCodeId ? line.taxRate : rateFor(line.vatTreatment, defaultVatRate);

function price(line: EditableLine, defaultVatRate: string): LineAmounts | null {
  try {
    return calculateLine({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxRate: lineRate(line, defaultVatRate),
      discount: readDiscount(line.discountType, line.discount),
    });
  } catch {
    return null;
  }
}

/** A line left completely blank is ignored rather than refused. */
export const isBlankLine = (line: EditableLine) =>
  line.description.trim() === '' && line.unitPrice.trim() === '';

/** The priced state of the lines and bill, for the parent's buttons and messages. */
export function useLineTotals(
  lines: EditableLine[],
  defaultVatRate: string,
  bill: BillDiscount = NO_BILL_DISCOUNT,
) {
  return useMemo(() => {
    const priced = lines.map((line) => ({ line, amounts: price(line, defaultVatRate) }));
    const used = priced.filter((entry) => !isBlankLine(entry.line));
    const amounts = used.flatMap((entry) => (entry.amounts ? [entry.amounts] : []));
    let totals: DocumentTotals;
    let billError: string | null = null;
    try {
      totals = calculateDocument(amounts, readDiscount(bill.type, bill.value)).totals;
    } catch (error) {
      billError = error instanceof Error ? error.message : 'Check the discount.';
      totals = calculateDocument(amounts).totals;
    }
    const rates = new Set(
      used.map((entry) =>
        formatMilli(signedToMilli(lineRate(entry.line, defaultVatRate))),
      ),
    );
    return {
      priced,
      totals,
      billError,
      vatLabel: rates.size === 1 ? `VAT ${[...rates][0]}%` : 'VAT',
      /** Some line is half-filled, an amount doesn't parse, or the bill discount doesn't. */
      incomplete:
        billError !== null ||
        used.some((entry) => !entry.amounts || entry.line.description.trim() === ''),
      count: used.length,
    };
  }, [lines, defaultVatRate, bill]);
}

export function DocumentLinesEditor({
  lines,
  onChange,
  bill,
  onBillChange,
  defaultVatRate,
  incomeAccounts,
  taxCodes,
}: {
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
  /** The discount on the whole bill. */
  bill: BillDiscount;
  onBillChange: (bill: BillDiscount) => void;
  defaultVatRate: string;
  /**
   * Invoices: the income accounts a line can book to. Omitted (quotations),
   * no account column is shown.
   */
  incomeAccounts?: { id: string; code: string; name: string }[];
  /** The tax code master. Given, each line picks a code instead of a treatment. */
  taxCodes?: TaxCodeOption[];
}) {
  const { priced, totals, vatLabel, billError } = useLineTotals(lines, defaultVatRate, bill);
  const billOff = toFils(totals.discountAmount) > 0;
  const rootRef = useRef<HTMLDivElement>(null);
  /** A line just added, whose description should take the focus once it renders. */
  const focusLine = useRef<string | null>(null);

  useEffect(() => {
    const key = focusLine.current;
    if (!key) return;
    focusLine.current = null;
    // Both layouts are rendered; focus the one on screen.
    const inputs =
      rootRef.current?.querySelectorAll<HTMLInputElement>(`[data-line="${key}"] input`) ?? [];
    Array.from(inputs)
      .find((input) => input.offsetParent !== null)
      ?.focus();
  }, [lines]);

  const update = (key: string, patch: Partial<EditableLine>) =>
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const remove = (key: string) => onChange(lines.filter((line) => line.key !== key));
  const add = (itemType: LineType) => {
    const line = newEditableLine(
      itemType,
      defaultVatRate,
      taxCodes?.find((code) => code.isDefault) ?? null,
    );
    focusLine.current = line.key;
    onChange([...lines, line]);
  };

  /*
   * Enter never submits the document from here — that issued invoices
   * half-typed. It moves to the next box, like a spreadsheet, and from the
   * last box of the last line it starts a new line.
   */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    const layout = event.target.closest<HTMLElement>('[data-layout]');
    if (!layout) return;
    const inputs = Array.from(layout.querySelectorAll<HTMLInputElement>('input'));
    const next = inputs[inputs.indexOf(event.target) + 1];
    if (next) {
      next.focus();
      next.select();
    } else {
      add(lines.at(-1)?.itemType ?? 'PART');
    }
  }

  return (
    <div ref={rootRef} onKeyDown={onKeyDown} className="flex flex-col gap-4">
      {/* Phone: each line a small card with labelled fields — never a sideways table. */}
      <ol data-layout="cards" className="flex flex-col gap-3 md:hidden">
        {priced.map(({ line, amounts }, index) => {
          const n = index + 1;
          return (
            <li
              key={line.key}
              data-line={line.key}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3.5"
            >
              <div className="flex items-center gap-2">
                <span className="w-6 text-sm font-semibold text-muted-foreground tabular-nums">
                  {n}
                </span>
                <TypeSwitch
                  value={line.itemType}
                  onChange={(itemType) => update(line.key, { itemType })}
                  label={`Line ${n} type`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ml-auto size-11"
                  aria-label={`Remove line ${n}`}
                  onClick={() => remove(line.key)}
                  disabled={lines.length === 1}
                >
                  <Trash2 />
                </Button>
              </div>
              <LabelledInput
                label="Description"
                aria={`Line ${n} description`}
                value={line.description}
                onChange={(value) => update(line.key, { description: value })}
                placeholder={
                  line.itemType === 'LABOUR' ? 'e.g. Labour and consumables' : 'e.g. Ignition coil'
                }
              />
              <div className="grid grid-cols-[1fr_1.4fr_1fr] gap-2">
                <LabelledInput
                  label="Qty"
                  aria={`Line ${n} quantity`}
                  value={line.quantity}
                  onChange={(value) => update(line.key, { quantity: value })}
                  numeric
                />
                <LabelledInput
                  label="Price"
                  aria={`Line ${n} price`}
                  value={line.unitPrice}
                  onChange={(value) => update(line.key, { unitPrice: value })}
                  placeholder="0.00"
                  numeric
                />
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">VAT</span>
                  <VatSelect
                    label={`Line ${n} VAT`}
                    line={line}
                    taxCodes={taxCodes}
                    onChange={(patch) => update(line.key, patch)}
                    large
                  />
                </label>
              </div>
              {incomeAccounts ? (
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">Account</span>
                  <AccountSelect
                    label={`Line ${n} account`}
                    value={line.accountId}
                    itemType={line.itemType}
                    accounts={incomeAccounts}
                    onChange={(accountId) => update(line.key, { accountId })}
                    large
                  />
                </label>
              ) : null}
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Discount</span>
                <DiscountInput
                  label={`Line ${n} discount`}
                  type={line.discountType}
                  value={line.discount}
                  onChange={(discount) =>
                    update(line.key, { discountType: discount.type, discount: discount.value })
                  }
                  large
                />
              </div>
              <p className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Amount</span>
                <LineAmount line={line} amounts={amounts} />
              </p>
            </li>
          );
        })}
      </ol>

      {/* Tablet and up: the sheet itself. */}
      <div
        data-layout="sheet"
        className="hidden overflow-x-auto rounded-xl border border-border md:block"
      >
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            <tr>
              <th className="w-12 px-3 py-2.5 text-right">S.No</th>
              <th className="w-40 px-2 py-2.5">Type</th>
              <th className="px-2 py-2.5">Description</th>
              {incomeAccounts ? <th className="w-44 px-2 py-2.5">Account</th> : null}
              <th className="w-20 px-2 py-2.5 text-right">Qty</th>
              <th className="w-28 px-2 py-2.5 text-right">Price</th>
              <th className="w-32 px-2 py-2.5">VAT</th>
              <th className="w-36 px-2 py-2.5 text-right">Discount</th>
              <th className="w-28 px-3 py-2.5 text-right">Amount</th>
              <th className="w-12 px-2 py-2.5">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {priced.map(({ line, amounts }, index) => {
              const n = index + 1;
              return (
                <tr key={line.key} data-line={line.key} className="align-middle">
                  <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">{n}</td>
                  <td className="px-2 py-2">
                    <TypeSwitch
                      value={line.itemType}
                      onChange={(itemType) => update(line.key, { itemType })}
                      label={`Line ${n} type`}
                      compact
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      aria-label={`Line ${n} description`}
                      value={line.description}
                      onChange={(event) => update(line.key, { description: event.target.value })}
                      placeholder={
                        line.itemType === 'LABOUR'
                          ? 'e.g. Labour and consumables'
                          : 'e.g. Ignition coil'
                      }
                    />
                  </td>
                  {incomeAccounts ? (
                    <td className="px-2 py-2">
                      <AccountSelect
                        label={`Line ${n} account`}
                        value={line.accountId}
                        itemType={line.itemType}
                        accounts={incomeAccounts}
                        onChange={(accountId) => update(line.key, { accountId })}
                      />
                    </td>
                  ) : null}
                  <td className="px-2 py-2">
                    <Input
                      aria-label={`Line ${n} quantity`}
                      inputMode="decimal"
                      value={line.quantity}
                      onChange={(event) => update(line.key, { quantity: event.target.value })}
                      className="text-right tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <Input
                      aria-label={`Line ${n} price`}
                      inputMode="decimal"
                      value={line.unitPrice}
                      placeholder="0.00"
                      onChange={(event) => update(line.key, { unitPrice: event.target.value })}
                      className="text-right tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <VatSelect
                      label={`Line ${n} VAT`}
                      line={line}
                      taxCodes={taxCodes}
                      onChange={(patch) => update(line.key, patch)}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <DiscountInput
                      label={`Line ${n} discount`}
                      type={line.discountType}
                      value={line.discount}
                      onChange={(discount) =>
                        update(line.key, { discountType: discount.type, discount: discount.value })
                      }
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <LineAmount line={line} amounts={amounts} />
                  </td>
                  <td className="px-2 py-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove line ${n}`}
                      onClick={() => remove(line.key)}
                      disabled={lines.length === 1}
                    >
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Button
          type="button"
          variant="outline"
          className="h-12 sm:h-10"
          onClick={() => add('PART')}
        >
          <Plus />
          <Package />
          Add part
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-12 sm:h-10"
          onClick={() => add('LABOUR')}
        >
          <Plus />
          <Wrench />
          Add labour
        </Button>
      </div>

      <dl className="flex flex-col gap-2 self-stretch rounded-xl bg-muted/50 px-4 py-4 text-sm sm:w-96 sm:self-end">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="tabular-nums">{formatMoney(totals.linesTotal)}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">Discount on the bill</dt>
          <dd className="flex items-center gap-3">
            <DiscountInput
              label="Discount on the bill"
              type={bill.type}
              value={bill.value}
              onChange={onBillChange}
            />
            <span className="w-24 text-right tabular-nums">
              {billOff ? `−${formatMoney(totals.discountAmount)}` : '—'}
            </span>
          </dd>
        </div>
        {billError ? (
          <p role="alert" className="text-right text-xs font-medium text-destructive">
            {billError}
          </p>
        ) : null}
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Total excl. VAT</dt>
          <dd className="tabular-nums">{formatMoney(totals.subtotal)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">{vatLabel}</dt>
          <dd className="tabular-nums">{formatMoney(totals.taxAmount)}</dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-border pt-2 text-base font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatMoney(totals.totalAmount)}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Parts / Labour, as a two-button switch — one tap, no dropdown. */
function TypeSwitch({
  value,
  onChange,
  label,
  compact = false,
}: {
  value: LineType;
  onChange: (value: LineType) => void;
  label: string;
  compact?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5"
    >
      {(['PART', 'LABOUR'] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cn(
            'rounded-md px-3 text-xs font-semibold tracking-wide uppercase transition-colors',
            compact ? 'h-8' : 'h-10',
            value === option
              ? 'bg-card text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option === 'PART' ? 'Parts' : 'Labour'}
        </button>
      ))}
    </div>
  );
}

function LineAmount({ line, amounts }: { line: EditableLine; amounts: LineAmounts | null }) {
  if (amounts) {
    const off = toFils(amounts.discountAmount) > 0;
    return (
      <span className="inline-flex flex-col items-end">
        <span className="font-semibold tabular-nums">{formatMoney(amounts.lineTotal)}</span>
        {off ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            less {formatMoney(amounts.discountAmount)}
          </span>
        ) : null}
      </span>
    );
  }
  if (line.unitPrice.trim() === '') return <span className="text-muted-foreground">—</span>;
  return <span className="text-xs font-medium text-destructive">Check the numbers</span>;
}

/**
 * How a line is treated for VAT. The rate follows from it (the workshop's
 * rate for standard-rated, nothing otherwise), so it can never be mistyped.
 */
function VatSelect({
  label,
  line,
  taxCodes,
  onChange,
  large = false,
}: {
  label: string;
  line: EditableLine;
  /** The tax code master; without it, the four treatments are offered. */
  taxCodes?: TaxCodeOption[];
  onChange: (patch: Partial<EditableLine>) => void;
  large?: boolean;
}) {
  const className = cn(
    'w-full min-w-0 rounded-lg border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
    large ? 'h-12 text-base' : 'h-9',
  );
  if (taxCodes?.length) {
    // A line saved before tax codes shows the code of its treatment.
    const value =
      line.taxCodeId || taxCodes.find((code) => code.treatment === line.vatTreatment)?.id || '';
    return (
      <select
        aria-label={label}
        value={value}
        onChange={(event) => {
          const code = taxCodes.find((option) => option.id === event.target.value);
          if (code) {
            onChange({
              taxCodeId: code.id,
              vatTreatment: code.treatment,
              taxRate: trimRate(code.rate),
            });
          }
        }}
        className={className}
        title={taxCodes.find((code) => code.id === value)?.name}
      >
        {value === '' ? <option value="">—</option> : null}
        {taxCodes.map((code) => (
          <option key={code.id} value={code.id}>
            {code.code}
            {code.treatment === 'STANDARD' ? ` ${trimRate(code.rate)}%` : ''}
          </option>
        ))}
      </select>
    );
  }
  return (
    <select
      aria-label={label}
      value={line.vatTreatment}
      onChange={(event) =>
        onChange({ vatTreatment: event.target.value as VatTreatment, taxCodeId: '' })
      }
      className={className}
    >
      {VAT_TREATMENTS.map((treatment) => (
        <option key={treatment.value} value={treatment.value}>
          {treatment.short}
        </option>
      ))}
    </select>
  );
}

/** Which income account a line books to; blank is the default for its type. */
function AccountSelect({
  label,
  value,
  itemType,
  accounts,
  onChange,
  large = false,
}: {
  label: string;
  value: string;
  itemType: LineType;
  accounts: { id: string; code: string; name: string }[];
  onChange: (accountId: string) => void;
  large?: boolean;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        'w-full min-w-0 rounded-lg border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
        large ? 'h-12 text-base' : 'h-9',
      )}
    >
      <option value="">Default — {itemType === 'LABOUR' ? 'labour' : 'parts'} sales</option>
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.code} · {account.name}
        </option>
      ))}
    </select>
  );
}

/**
 * A discount box: the value, and a switch between a percentage and an AED
 * amount beside it. Blank means no discount.
 */
function DiscountInput({
  label,
  type,
  value,
  onChange,
  large = false,
}: {
  label: string;
  type: DiscountType;
  value: string;
  onChange: (discount: BillDiscount) => void;
  large?: boolean;
}) {
  const other: DiscountType = type === 'PERCENT' ? 'AMOUNT' : 'PERCENT';
  const unit = (kind: DiscountType) => (kind === 'PERCENT' ? 'percent' : 'AED');
  return (
    <span className="flex">
      <Input
        aria-label={`${label} (${unit(type)})`}
        inputMode="decimal"
        value={value}
        placeholder="0"
        onChange={(event) => onChange({ type, value: event.target.value })}
        className={cn(
          'min-w-0 rounded-r-none text-right tabular-nums',
          large ? 'h-12 text-base' : 'w-20',
        )}
      />
      <button
        type="button"
        onClick={() => onChange({ type: other, value })}
        title={`Switch to ${unit(other)}`}
        aria-label={`${label}: switch to ${unit(other)}`}
        className={cn(
          'shrink-0 rounded-r-lg border border-l-0 border-input bg-muted/40 px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          large ? 'h-12 min-w-14' : 'h-9 min-w-11',
        )}
      >
        {type === 'PERCENT' ? '%' : 'AED'}
      </button>
    </span>
  );
}

function LabelledInput({
  label,
  aria,
  value,
  onChange,
  placeholder,
  numeric = false,
}: {
  label: string;
  aria: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  numeric?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Input
        aria-label={aria}
        value={value}
        inputMode={numeric ? 'decimal' : undefined}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={cn('h-12 text-base', numeric && 'text-right tabular-nums')}
      />
    </label>
  );
}
