'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Banknote, CheckCircle2, TriangleAlert, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import type { PaymentMethod } from '@/generated/prisma/enums';
import { Button } from '@/components/ui/button';
import { Field, FormError, NativeSelect, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { Panel } from '@/components/layout/primitives';
import type { ActionResult } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import { recordSupplierPaymentAction } from '@/app/(app)/finance/payables/actions';
import { cn } from '@/lib/utils';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'CASH', label: 'Cash' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'CARD', label: 'Card' },
  { value: 'ONLINE', label: 'Online' },
];

const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.value, m.label])) as Record<
  PaymentMethod,
  string
>;

export interface PayablePurchase {
  id: string;
  number: string;
  supplierInvoiceNumber: string | null;
  supplierName: string;
  balance: string;
  balanceFils: number;
  received: string;
  paid: string;
}

/** Fils from a typed amount, or null if it isn't a usable number yet. */
function parseAmount(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const fils = Math.round(Number(trimmed) * 100);
  return Number.isFinite(fils) ? fils : null;
}

/*
 * Paying a supplier.
 *
 * Two steps on purpose. The form is where the amount is typed; the
 * confirmation restates what is about to happen in the workshop's own terms
 * — this supplier, this bill, this much, and what will be left — before any
 * money is recorded. Paying the wrong supplier invoice is the expensive
 * mistake here, and it is the one a second look catches.
 *
 * The server checks all of it again regardless: this screen cannot let
 * through an overpayment, a future date, or another branch's bill.
 */
export function SupplierPaymentForm({
  purchase,
  defaultPaidAt,
  backHref,
}: {
  purchase: PayablePurchase;
  /** Now, in the workshop's timezone, from the server. */
  defaultPaidAt: string;
  backHref: string;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState(defaultPaidAt);
  const [confirming, setConfirming] = useState(false);

  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await recordSupplierPaymentAction(purchase.id, prev, formData);
      if (result.ok) {
        toast.success(`${formatMoney(amount)} recorded for ${purchase.supplierName}`);
        router.push(backHref);
        router.refresh();
      } else {
        // Back to the form so the mistake can be corrected in place.
        setConfirming(false);
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};

  const amountFils = useMemo(() => parseAmount(amount), [amount]);
  const remaining = amountFils === null ? null : purchase.balanceFils - amountFils;
  const tooMuch = remaining !== null && remaining < 0;
  const settles = remaining === 0;
  const ready = amountFils !== null && amountFils > 0 && !tooMuch && paidAt.length > 0;

  const money = (fils: number) => formatMoney((fils / 100).toFixed(2));

  return (
    <div className="flex flex-col gap-5">
      {/* What is owed — the number this whole screen is about. */}
      <Panel className="flex flex-col gap-1 border-primary/25 bg-primary/[0.04]">
        <span className="text-xs font-medium text-muted-foreground">
          Outstanding on {purchase.number}
          {purchase.supplierInvoiceNumber ? ` · ${purchase.supplierInvoiceNumber}` : ''}
        </span>
        <span className="text-3xl leading-none font-semibold tracking-[-0.02em] tabular-nums">
          {formatMoney(purchase.balance)}
        </span>
        <span className="text-xs text-muted-foreground">
          {purchase.supplierName} · {formatMoney(purchase.received)} received,{' '}
          {formatMoney(purchase.paid)} paid
        </span>
      </Panel>

      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        {/* Hidden mirrors so the confirmed values are what get posted. */}
        <input type="hidden" name="amount" value={amount} />
        <input type="hidden" name="method" value={method} />
        <input type="hidden" name="referenceNumber" value={reference} />
        <input type="hidden" name="paidAt" value={paidAt} />

        <div hidden={confirming} className="flex flex-col gap-5">
          <Field
            label="Amount paid"
            htmlFor="supplier-payment-amount"
            required
            error={errors.amount}
            hint={`Up to ${formatMoney(purchase.balance)}.`}
          >
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-base font-medium text-muted-foreground">
                AED
              </span>
              <input
                id="supplier-payment-amount"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                aria-describedby="supplier-payment-remaining"
                className="h-16 w-full rounded-xl border border-input bg-card pr-4 pl-16 text-right text-2xl font-semibold tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
          </Field>

          {/* One tap to settle in full — the commonest case. */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAmount((purchase.balanceFils / 100).toFixed(2))}
              className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted active:bg-muted"
            >
              <CheckCircle2 className="size-4" />
              Pay in full ({formatMoney(purchase.balance)})
            </button>
          </div>

          <p
            id="supplier-payment-remaining"
            aria-live="polite"
            className={cn(
              'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm',
              tooMuch
                ? 'border-danger/30 bg-danger/5 text-danger'
                : settles
                  ? 'border-success/30 bg-success/5 text-success'
                  : 'border-border bg-muted/40 text-muted-foreground',
            )}
          >
            {tooMuch ? (
              <>
                <TriangleAlert className="size-4 shrink-0" />
                That is {money(-remaining!)} more than is owed.
              </>
            ) : remaining === null ? (
              <>Enter an amount to see what would be left.</>
            ) : settles ? (
              <>
                <CheckCircle2 className="size-4 shrink-0" />
                This settles {purchase.number} in full.
              </>
            ) : (
              <>
                Remaining after this payment:{' '}
                <span className="font-semibold tabular-nums text-foreground">
                  {money(remaining)}
                </span>
              </>
            )}
          </p>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Paid by" htmlFor="supplier-payment-method" required error={errors.method}>
              <NativeSelect
                id="supplier-payment-method"
                value={method}
                onChange={(event) => setMethod(event.target.value as PaymentMethod)}
                className="h-12 text-base md:h-11 md:text-sm"
              >
                {METHODS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              label="Payment date"
              htmlFor="supplier-payment-date"
              required
              error={errors.paidAt}
            >
              <input
                id="supplier-payment-date"
                type="datetime-local"
                value={paidAt}
                onChange={(event) => setPaidAt(event.target.value)}
                className="h-12 w-full rounded-lg border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:h-11 md:text-sm"
              />
            </Field>
          </div>

          <TextField
            label="Reference"
            name="reference-display"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            error={errors.referenceNumber}
            hint="Optional. Cheque number, transfer reference — whatever you would look up later."
            className="[&_input]:h-12 [&_input]:text-base md:[&_input]:h-11 md:[&_input]:text-sm"
          />

          <FormError message={Object.keys(errors).length ? undefined : state.error} />

          <div className="flex flex-col gap-2 border-t border-border pt-5 sm:flex-row-reverse">
            <Button
              type="button"
              size="lg"
              className="h-13 w-full sm:h-11 sm:w-auto"
              disabled={!ready}
              onClick={() => setConfirming(true)}
            >
              <Wallet />
              Review payment
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-13 w-full sm:h-11 sm:w-auto"
              onClick={() => router.push(backHref)}
            >
              Cancel
            </Button>
          </div>
        </div>

        {/* Step two: say plainly what is about to happen. */}
        <div hidden={!confirming} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h3 className="text-base font-semibold">Record this payment?</h3>
            <p className="text-sm text-muted-foreground">
              Check it against the supplier’s invoice. A payment recorded in error can be reversed,
              but it stays on the record.
            </p>
          </div>

          <Panel padding="none" className="overflow-hidden">
            <dl className="divide-y divide-border text-sm">
              {[
                ['Supplier', purchase.supplierName],
                [
                  'Purchase',
                  `${purchase.number}${purchase.supplierInvoiceNumber ? ` · ${purchase.supplierInvoiceNumber}` : ''}`,
                ],
                ['Currently outstanding', formatMoney(purchase.balance)],
                ['Payment amount', amountFils === null ? '—' : money(amountFils)],
                ['Remaining after', remaining === null ? '—' : money(Math.max(remaining, 0))],
                ['Method', METHOD_LABEL[method]],
                ...(reference ? [['Reference', reference] as [string, string]] : []),
              ].map(([label, value], index) => (
                <div
                  key={label}
                  className={cn(
                    'flex items-baseline justify-between gap-4 px-4 py-3.5 sm:px-6',
                    // The two figures that matter get the weight.
                    (index === 3 || index === 4) && 'bg-muted/30',
                  )}
                >
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd
                    className={cn(
                      'text-right font-medium tabular-nums',
                      index === 3 && 'text-base font-semibold',
                    )}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>

          {settles ? (
            <p className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/5 px-3 py-2.5 text-sm text-success">
              <CheckCircle2 className="size-4 shrink-0" />
              {purchase.number} will be fully settled.
            </p>
          ) : null}

          <FormError message={Object.keys(errors).length ? undefined : state.error} />

          <div className="flex flex-col gap-2 border-t border-border pt-5 sm:flex-row-reverse">
            <SubmitButton
              pending={isPending}
              size="lg"
              className="h-13 w-full sm:h-11 sm:w-auto"
              pendingLabel="Recording…"
            >
              <Banknote />
              Record payment
            </SubmitButton>
            <Button
              type="button"
              variant="ghost"
              className="h-13 w-full sm:h-11 sm:w-auto"
              disabled={isPending}
              onClick={() => setConfirming(false)}
            >
              <ArrowLeft />
              Back to edit
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
