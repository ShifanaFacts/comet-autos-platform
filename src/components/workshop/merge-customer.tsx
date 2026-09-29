'use client';

import { useRef, useState, useTransition } from 'react';
import { ArrowRight, Loader2, Merge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/forms/fields';
import { CustomerPicker, type PickedParty } from '@/components/workshop/customer-picker';
import type { MergePreview } from '@/lib/customers/merge';
import { mergeCustomerAction } from '@/app/(app)/customers/actions';

function newRequestKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** "3 vehicles, 12 job cards, 9 invoices" — only what there is. */
function describe(preview: MergePreview) {
  const parts = [
    [preview.vehicles, 'vehicle'],
    [preview.jobCards, 'job card'],
    [preview.quotations, 'quotation'],
    [preview.invoices, 'invoice'],
    [preview.creditNotes, 'credit note'],
    [preview.appointments, 'appointment'],
  ] as const;
  const text = parts
    .filter(([count]) => count > 0)
    .map(([count, word]) => `${count} ${word}${count === 1 ? '' : 's'}`)
    .join(', ');
  return text || 'no records yet';
}

/**
 * Merges this customer into another: pick the one to keep, check what will
 * move, confirm. The kept customer's page opens afterwards.
 */
export function MergeCustomerButton({
  customerId,
  name,
  phone,
  preview,
}: {
  customerId: string;
  name: string;
  phone: string;
  preview: MergePreview;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PickedParty | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const requestKey = useRef('');

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setPicked(null);
      setReason('');
      setError(null);
      requestKey.current = newRequestKey();
    }
  }

  const self = picked?.customer.id === customerId;

  function merge() {
    if (!picked || self) return;
    setError(null);
    startTransition(async () => {
      // Opens the kept customer when it succeeds; only a failure comes back.
      const result = await mergeCustomerAction(customerId, {
        targetId: picked.customer.id,
        reason: reason.trim(),
        requestKey: requestKey.current,
      });
      if (result && !result.ok) setError(result.error ?? 'The customers could not be merged.');
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Button variant="outline" size="lg" onClick={() => onOpenChange(true)}>
        <Merge />
        Merge
      </Button>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge {name} into another customer</DialogTitle>
          <DialogDescription>
            For a customer entered twice. Everything on this record — {describe(preview)} — moves to
            the customer you keep, and this record is archived. Invoices already issued keep the
            name printed on them.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <p className="text-sm font-medium">Which customer do you keep?</p>
          <CustomerPicker value={picked} onChange={setPicked} allowJobCard={false} autoFocus />
          {self ? (
            <p role="alert" className="text-sm text-destructive">
              That is this customer. Choose the other record — the one to keep.
            </p>
          ) : null}

          {picked && !self ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {phone} · archived
                </span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 text-right">
                <span className="block truncate font-medium">{picked.customer.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {picked.customer.phone} · kept
                </span>
              </span>
            </div>
          ) : null}

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">
              Reason <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Same customer, entered with a second mobile number"
              maxLength={500}
              className="min-h-16"
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Never mind
          </Button>
          <Button disabled={!picked || self || isPending} onClick={merge}>
            {isPending ? <Loader2 className="animate-spin" /> : <Merge />}
            {isPending ? 'Merging…' : 'Merge customers'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
