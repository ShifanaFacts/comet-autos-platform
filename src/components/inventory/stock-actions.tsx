'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Minus, PackageCheck, Plus, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FormError, NativeSelect, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { ConfirmAction } from '@/components/shared/confirm-action';
import type { ActionResult } from '@/lib/errors';
import { ADJUSTMENT_REASONS } from '@/lib/inventory/labels';
import { formatMilli } from '@/lib/money';
import { cn } from '@/lib/utils';
import {
  adjustStockAction,
  cancelPurchaseAction,
  receivePurchaseAction,
  reverseMovementAction,
} from '@/app/(app)/inventory/actions';

const REASONS_IN: (keyof typeof ADJUSTMENT_REASONS)[] = ['FOUND', 'COUNT_CORRECTION', 'OTHER'];
const REASONS_OUT: (keyof typeof ADJUSTMENT_REASONS)[] = [
  'DAMAGED',
  'LOST',
  'WORKSHOP_USE',
  'COUNT_CORRECTION',
  'OTHER',
];

/** Manual stock correction: direction, quantity, reason. Posts one ADJUSTMENT to the ledger. */
export function AdjustStockForm({
  partId,
  unit,
  onHandMilli,
}: {
  partId: string;
  unit: string;
  onHandMilli: number;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [direction, setDirection] = useState<'IN' | 'OUT'>('OUT');
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await adjustStockAction(partId, prev, formData);
      if (result.ok) {
        toast.success('Stock adjusted');
        formRef.current?.reset();
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};
  const reasons = direction === 'IN' ? REASONS_IN : REASONS_OUT;

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-5">
      <input type="hidden" name="direction" value={direction} />
      <div role="radiogroup" aria-label="Direction" className="grid grid-cols-2 gap-2">
        {(['OUT', 'IN'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={direction === value}
            onClick={() => setDirection(value)}
            className={cn(
              'flex h-11 items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors',
              direction === value
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-border text-muted-foreground hover:bg-muted/50',
            )}
          >
            {value === 'OUT' ? <Minus className="size-4" /> : <Plus className="size-4" />}
            {value === 'OUT' ? 'Remove stock' : 'Add stock'}
          </button>
        ))}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          label={`Quantity (${unit})`}
          name="quantity"
          inputMode="decimal"
          required
          error={errors.quantity}
          hint={direction === 'OUT' ? `${formatMilli(onHandMilli)} on hand` : undefined}
          className="[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm"
        />
        <Field label="Reason" htmlFor="reason" required error={errors.reason}>
          <NativeSelect
            id="reason"
            name="reason"
            required
            key={direction}
            defaultValue={reasons[0]}
            className="h-11 text-base md:text-sm"
          >
            {reasons.map((reason) => (
              <option key={reason} value={reason}>
                {ADJUSTMENT_REASONS[reason]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <TextField
        label="Details"
        name="note"
        error={errors.note}
        hint="Required for “Other”. Shown in the stock history."
        className="[&_input]:h-11"
      />
      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <SubmitButton
        pending={isPending}
        size="lg"
        className="h-11 self-start"
        pendingLabel="Saving…"
      >
        Record adjustment
      </SubmitButton>
    </form>
  );
}

/** Reverses one adjustment / opening-stock row after asking why. The original row stays in the history. */
export function ReverseMovementButton({
  transactionId,
  quantity,
}: {
  transactionId: string;
  quantity: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            <Undo2 />
            Reverse
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reverse this movement?</DialogTitle>
          <DialogDescription>
            A reversal of {quantity > 0 ? '−' : '+'}
            {formatMilli(Math.abs(quantity))} is added to the stock history. The original entry is
            kept and marked as reversed.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <label htmlFor={`reverse-${transactionId}`} className="text-sm font-medium">
            Reason
          </label>
          <Input
            id={`reverse-${transactionId}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Entered on the wrong part"
            className="h-11"
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Never mind
          </Button>
          <Button
            variant="destructive"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await reverseMovementAction(transactionId, reason);
                if (!result.ok) return setError(result.error ?? 'Could not reverse the movement.');
                toast.success('Movement reversed');
                setOpen(false);
                router.refresh();
              })
            }
          >
            {isPending ? 'Working…' : 'Reverse movement'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface ReceiveLine {
  id: string;
  sku: string;
  name: string;
  unit: string;
  orderedMilli: number;
  receivedMilli: number;
  outstandingMilli: number;
}

/** Receives stock against a purchase: each line defaults to everything still outstanding. */
export function ReceivePurchaseForm({
  purchaseId,
  lines,
}: {
  purchaseId: string;
  lines: ReceiveLine[];
}) {
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await receivePurchaseAction(purchaseId, prev, formData);
      if (result.ok) toast.success('Stock received');
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};
  const open = lines.filter((line) => line.outstandingMilli > 0);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {open.map((line) => (
          <li
            key={line.id}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-medium">{line.name}</p>
              <p className="text-xs text-muted-foreground">
                <span className="font-mono">{line.sku}</span> · ordered{' '}
                {formatMilli(line.orderedMilli)}
                {line.receivedMilli > 0 ? ` · received ${formatMilli(line.receivedMilli)}` : ''}
              </p>
              {errors[`line:${line.id}`] ? (
                <p className="mt-1 text-xs text-destructive">{errors[`line:${line.id}`]}</p>
              ) : null}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Receiving</span>
              <Input
                name={`line:${line.id}`}
                inputMode="decimal"
                defaultValue={formatMilli(line.outstandingMilli)}
                aria-label={`Quantity of ${line.sku} received`}
                aria-invalid={errors[`line:${line.id}`] ? true : undefined}
                className="h-11 w-24 text-right text-base tabular-nums md:text-sm"
              />
              <span className="w-12 text-muted-foreground">{line.unit}</span>
            </label>
          </li>
        ))}
      </ul>
      <FormError
        message={
          state.error && !Object.keys(errors).some((key) => key.startsWith('line:'))
            ? state.error
            : undefined
        }
      />
      <SubmitButton
        pending={isPending}
        size="lg"
        className="h-11 self-start"
        pendingLabel="Receiving…"
      >
        <PackageCheck />
        Receive into stock
      </SubmitButton>
    </form>
  );
}

export function CancelPurchaseButton({
  purchaseId,
  purchaseNumber,
}: {
  purchaseId: string;
  purchaseNumber: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <ConfirmAction
        trigger={
          <Button variant="outline" size="lg">
            <Ban />
            Cancel purchase
          </Button>
        }
        title={`Cancel ${purchaseNumber}?`}
        description="Nothing has been received on it, so stock doesn't change. The purchase stays on file as cancelled."
        confirmLabel="Cancel purchase"
        onConfirm={async () => {
          const result = await cancelPurchaseAction(purchaseId);
          if (!result.ok) return setError(result.error ?? 'Could not cancel the purchase.');
          toast.success('Purchase cancelled');
          router.refresh();
        }}
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
