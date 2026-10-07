'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { HandCoins, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormError, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { formatMoney } from '@/lib/format';
import { filsToString, toFils } from '@/lib/money';
import type { ActionResult } from '@/lib/errors';
import { settleShortPaymentAction } from '@/app/(app)/finance/invoices/actions';

const INPUT = '[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm';
/** The most a round-off may take off (lib/billing/document-lines.ts). */
const MAX_FILS = 500;

/**
 * "The customer actually paid less": a paid invoice recorded at, say,
 * 2,600.85 when 2,600.00 was handed over. One step reverses the payment,
 * rounds the invoice off by the difference (VAT unchanged) and records what
 * really came in — on the same date, into the same account.
 */
export function ShortPaymentButton({
  invoiceId,
  invoiceNumber,
  paid,
  total,
}: {
  invoiceId: string;
  invoiceNumber: string;
  /** Recorded as received, "2600.85". */
  paid: string;
  total: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [received, setReceived] = useState('');
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await settleShortPaymentAction(invoiceId, prev, formData);
      if (result.ok) {
        toast.success(`${invoiceNumber} corrected to what was received`);
        router.refresh();
        setOpen(false);
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};
  const valid = /^\d+(\.\d{1,2})?$/.test(received.trim());
  const difference = valid ? toFils(paid) - toFils(received.trim()) : 0;
  const tooBig = difference > MAX_FILS;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" className="h-10" onClick={() => setOpen(true)}>
        <HandCoins />
        Paid less?
      </Button>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>The customer actually paid less</DialogTitle>
          <DialogDescription>
            {formatMoney(paid)} is recorded as received for {invoiceNumber}. Enter what was really
            handed over: the payment is reversed and recorded again for that amount, on the same
            date into the same account, and the invoice is rounded off by the difference — the VAT
            stays as issued. Up to {formatMoney(filsToString(MAX_FILS))}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <TextField
            id="short-received"
            label="Actually received"
            name="received"
            numeric="money"
            required
            autoFocus
            value={received}
            onChange={(event) => setReceived(event.target.value)}
            placeholder={paid}
            error={errors.received}
            className={INPUT}
          />
          <TextField
            id="short-reason"
            label="Why"
            name="reason"
            required
            defaultValue="Customer paid a round amount"
            error={errors.reason}
            className={INPUT}
          />
          {valid && difference > 0 ? (
            <dl
              className={
                tooBig
                  ? 'rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm'
                  : 'rounded-lg border border-border bg-muted/40 p-3 text-sm'
              }
            >
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Round-off</dt>
                <dd className="font-medium tabular-nums">
                  −{formatMoney(filsToString(difference))}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Invoice total</dt>
                <dd className="font-medium tabular-nums">
                  {formatMoney(total)} → {formatMoney(filsToString(toFils(total) - difference))}
                </dd>
              </div>
              {tooBig ? (
                <p className="mt-2 text-destructive">
                  More than a round-off — give a discount or a credit note instead.
                </p>
              ) : null}
            </dl>
          ) : null}
          <FormError message={Object.keys(errors).length ? undefined : state.error} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" size="lg" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton
              size="lg"
              pending={isPending}
              disabled={!valid || difference <= 0 || tooBig}
              pendingLabel="Correcting…"
            >
              <Save />
              Correct to {valid && difference > 0 ? formatMoney(received.trim()) : 'this amount'}
            </SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
