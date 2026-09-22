'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Package, Plus, Save, Send, Trash2, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FormError } from '@/components/forms/fields';
import { ConfirmAction } from '@/components/shared/confirm-action';
import { TableWrap } from '@/components/shared/record-card';
import { calculateLine, calculateTotals, type LineAmounts } from '@/lib/money';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { saveAndSendEstimateAction, saveEstimateDraftAction } from '../actions';
import { CustomerLinkPanel } from './customer-link-panel';

export interface DraftLine {
  key: string;
  itemType: 'LABOUR' | 'PART';
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
}

function tryLine(line: DraftLine, defaultVatRate: string): LineAmounts | null {
  try {
    return calculateLine({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxRate: line.taxRate || defaultVatRate,
    });
  } catch {
    return null;
  }
}

/** "5.00" → "5" for display in the rate input. */
const trimRate = (rate: string) => (rate.includes('.') ? rate.replace(/\.?0+$/, '') : rate);

let counter = 0;
const newLine = (itemType: DraftLine['itemType'], defaultVatRate: string): DraftLine => ({
  key: `new-${Date.now()}-${counter++}`,
  itemType,
  description: '',
  quantity: '1',
  unitPrice: '',
  taxRate: trimRate(defaultVatRate),
});

export function EstimateBuilder({
  jobCardId,
  estimateId,
  initialLines,
  initialValidUntil,
  minValidUntil,
  recommendation,
  customerName,
  defaultVatRate,
}: {
  jobCardId: string;
  estimateId: string;
  initialLines: DraftLine[];
  initialValidUntil: string;
  minValidUntil: string;
  recommendation: string | null;
  customerName: string;
  /** Organization default VAT rate, from lib/tax.ts on the server. */
  defaultVatRate: string;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<DraftLine[]>(
    initialLines.length > 0 ? initialLines : [newLine('LABOUR', defaultVatRate)],
  );
  const [validUntil, setValidUntil] = useState(initialValidUntil);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ link: string; whatsappUrl: string } | null>(null);
  const [pending, setPending] = useState<'save' | 'send' | null>(null);
  const [isPending, startTransition] = useTransition();

  const priced = useMemo(
    () => lines.map((line) => ({ line, amounts: tryLine(line, defaultVatRate) })),
    [lines, defaultVatRate],
  );
  const totals = useMemo(
    () => calculateTotals(priced.flatMap((p) => (p.amounts ? [p.amounts] : []))),
    [priced],
  );
  const incomplete = priced.some((p) => !p.amounts || p.line.description.trim() === '');

  function update(key: string, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function payload() {
    return {
      validUntil,
      items: lines
        .filter((line) => !(line.description.trim() === '' && line.unitPrice.trim() === ''))
        .map(({ itemType, description, quantity, unitPrice, taxRate }) => ({
          itemType,
          description,
          quantity,
          unitPrice,
          taxRate,
        })),
    };
  }

  function save() {
    setError(null);
    setPending('save');
    startTransition(async () => {
      const result = await saveEstimateDraftAction(jobCardId, estimateId, payload());
      setPending(null);
      if (!result.ok) return setError(result.error ?? 'Could not save the estimate.');
      toast.success('Draft saved');
      router.refresh();
    });
  }

  function send() {
    setError(null);
    setPending('send');
    startTransition(async () => {
      const result = await saveAndSendEstimateAction(jobCardId, estimateId, payload());
      setPending(null);
      if (!result.ok || !result.data)
        return setError(result.error ?? 'Could not send the estimate.');
      setLink(result.data);
      toast.success('Estimate sent — share the link with the customer');
    });
  }

  if (link) {
    return (
      <CustomerLinkPanel
        link={link.link}
        whatsappUrl={link.whatsappUrl}
        customerName={customerName}
        onDone={() => router.refresh()}
      />
    );
  }

  const labour = priced.filter((p) => p.line.itemType === 'LABOUR');
  const parts = priced.filter((p) => p.line.itemType === 'PART');

  return (
    <div className="flex flex-col gap-8">
      {recommendation ? (
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-4 sm:px-6">
          <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Recommended work (from diagnosis)
          </p>
          <p className="mt-2 text-sm whitespace-pre-wrap">{recommendation}</p>
        </div>
      ) : null}

      {[
        {
          type: 'LABOUR' as const,
          title: 'Labour',
          icon: Wrench,
          rows: labour,
          qtyLabel: 'Hours',
          priceLabel: 'Rate (AED)',
        },
        {
          type: 'PART' as const,
          title: 'Parts',
          icon: Package,
          rows: parts,
          qtyLabel: 'Qty',
          priceLabel: 'Unit price (AED)',
        },
      ].map((group) => (
        <section key={group.type} className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <group.icon className="size-4 text-muted-foreground" />
              {group.title}
            </h2>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setLines((current) => [...current, newLine(group.type, defaultVatRate)])
              }
            >
              <Plus />
              Add {group.type === 'LABOUR' ? 'labour' : 'part'}
            </Button>
          </div>

          {group.rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No {group.title.toLowerCase()} lines.
            </p>
          ) : (
            <div className="rounded-xl border border-border bg-card shadow-xs">
              {/* Phone: each line stacked, with its own labelled fields — never a sideways scroll. */}
              <ul className="divide-y divide-border md:hidden">
                {group.rows.map(({ line, amounts }) => (
                  <li key={line.key} className="flex flex-col gap-3 p-4">
                    <Field label="Description" htmlFor={`${line.key}-description`}>
                      <Input
                        id={`${line.key}-description`}
                        value={line.description}
                        onChange={(event) => update(line.key, { description: event.target.value })}
                        placeholder={
                          group.type === 'LABOUR'
                            ? 'e.g. Replace AC compressor clutch'
                            : 'e.g. Front brake pad set'
                        }
                        className="h-11 text-base"
                      />
                    </Field>
                    <div className="grid grid-cols-3 gap-2">
                      <Field label={group.qtyLabel} htmlFor={`${line.key}-quantity`}>
                        <Input
                          id={`${line.key}-quantity`}
                          inputMode="decimal"
                          value={line.quantity}
                          onChange={(event) => update(line.key, { quantity: event.target.value })}
                          className="h-11 text-right text-base tabular-nums"
                        />
                      </Field>
                      <Field label={group.priceLabel} htmlFor={`${line.key}-price`}>
                        <Input
                          id={`${line.key}-price`}
                          inputMode="decimal"
                          value={line.unitPrice}
                          onChange={(event) => update(line.key, { unitPrice: event.target.value })}
                          placeholder="0.00"
                          className="h-11 text-right text-base tabular-nums"
                        />
                      </Field>
                      <Field label="VAT %" htmlFor={`${line.key}-vat`}>
                        <Input
                          id={`${line.key}-vat`}
                          inputMode="decimal"
                          value={line.taxRate}
                          onChange={(event) => update(line.key, { taxRate: event.target.value })}
                          className="h-11 text-right text-base tabular-nums"
                        />
                      </Field>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className={cn(
                          'text-sm font-semibold tabular-nums',
                          !amounts && line.unitPrice !== '' && 'text-destructive',
                        )}
                      >
                        {amounts
                          ? formatMoney(amounts.lineTotal)
                          : line.unitPrice === ''
                            ? '—'
                            : 'Check the price'}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setLines((current) => current.filter((l) => l.key !== line.key))
                        }
                      >
                        <Trash2 />
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              <TableWrap>
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="bg-muted/40 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    <tr>
                      <th className="px-4 py-3 pl-6">Description</th>
                      <th className="w-24 px-2 py-3">{group.qtyLabel}</th>
                      <th className="w-36 px-2 py-3">{group.priceLabel}</th>
                      <th className="w-20 px-2 py-3">VAT %</th>
                      <th className="w-32 px-4 py-3 text-right">Amount</th>
                      <th className="w-12 py-3 pr-4" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {group.rows.map(({ line, amounts }) => (
                      <tr key={line.key} className="align-top">
                        <td className="px-4 py-3 pl-6">
                          <Input
                            aria-label="Description"
                            value={line.description}
                            onChange={(event) =>
                              update(line.key, { description: event.target.value })
                            }
                            placeholder={
                              group.type === 'LABOUR'
                                ? 'e.g. Replace AC compressor clutch'
                                : 'e.g. Front brake pad set'
                            }
                          />
                        </td>
                        <td className="px-2 py-3">
                          <Input
                            aria-label={group.qtyLabel}
                            inputMode="decimal"
                            value={line.quantity}
                            onChange={(event) => update(line.key, { quantity: event.target.value })}
                            className="text-right tabular-nums"
                          />
                        </td>
                        <td className="px-2 py-3">
                          <Input
                            aria-label={group.priceLabel}
                            inputMode="decimal"
                            value={line.unitPrice}
                            onChange={(event) =>
                              update(line.key, { unitPrice: event.target.value })
                            }
                            placeholder="0.00"
                            className="text-right tabular-nums"
                          />
                        </td>
                        <td className="px-2 py-3">
                          <Input
                            aria-label="VAT %"
                            inputMode="decimal"
                            value={line.taxRate}
                            onChange={(event) => update(line.key, { taxRate: event.target.value })}
                            className="text-right tabular-nums"
                          />
                        </td>
                        <td
                          className={cn(
                            'px-4 py-3 pt-5 text-right font-medium tabular-nums',
                            !amounts && line.unitPrice !== '' && 'text-destructive',
                          )}
                        >
                          {amounts
                            ? formatMoney(amounts.lineTotal)
                            : line.unitPrice === ''
                              ? '—'
                              : 'Check'}
                        </td>
                        <td className="py-3 pr-4">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Remove line"
                            onClick={() =>
                              setLines((current) => current.filter((l) => l.key !== line.key))
                            }
                          >
                            <Trash2 />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </div>
          )}
        </section>
      ))}

      <div className="grid gap-8 border-t border-border pt-8 md:grid-cols-2">
        <Field
          label="Quotation valid until"
          htmlFor="validUntil"
          required
          hint="The customer's link stops working after this date."
        >
          <Input
            id="validUntil"
            type="date"
            min={minValidUntil}
            value={validUntil}
            onChange={(event) => setValidUntil(event.target.value)}
            className="max-w-48"
          />
        </Field>

        <dl className="flex flex-col gap-3 text-sm md:ml-auto md:w-80">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="tabular-nums">{formatMoney(totals.subtotal)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">VAT</dt>
            <dd className="tabular-nums">{formatMoney(totals.taxAmount)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-border pt-3 text-base font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatMoney(totals.totalAmount)}</dd>
          </div>
        </dl>
      </div>

      <FormError message={error ?? undefined} />

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-6">
        {incomplete ? (
          <p className="mr-auto text-sm text-muted-foreground">
            Every line needs a description and a valid amount before sending.
          </p>
        ) : null}
        <Button variant="outline" size="lg" disabled={isPending} onClick={save}>
          {pending === 'save' ? <Loader2 className="animate-spin" /> : <Save />}
          Save draft
        </Button>
        <ConfirmAction
          tone="default"
          trigger={
            <Button size="lg" disabled={isPending || incomplete || lines.length === 0}>
              {pending === 'send' ? <Loader2 className="animate-spin" /> : <Send />}
              Send to customer
            </Button>
          }
          title={`Send ${formatMoney(totals.totalAmount)} quotation?`}
          description={`The estimate is locked and ${customerName} gets a secure link to approve or reject it. Changes after this need a new version.`}
          confirmLabel="Send quotation"
          onConfirm={async () => send()}
        />
      </div>
    </div>
  );
}
