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
import { NativeSelect, Textarea } from '@/components/forms/fields';
import type { SupplierMergeOptions } from '@/lib/inventory/supplier-merge';
import { mergeSupplierAction } from '@/app/(app)/inventory/actions';

function newRequestKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** "4 purchases, 9 parts" — only what there is. */
function describe(options: SupplierMergeOptions) {
  const parts = [
    [options.purchases, 'purchase'],
    [options.parts, 'part'],
  ] as const;
  const text = parts
    .filter(([count]) => count > 0)
    .map(([count, word]) => `${count} ${word}${count === 1 ? '' : 's'}`)
    .join(', ');
  return text || 'no records yet';
}

/**
 * Merges this supplier into another: pick the one to keep, check what will
 * move, confirm. The kept supplier's page opens afterwards.
 */
export function MergeSupplierButton({
  supplierId,
  name,
  options,
}: {
  supplierId: string;
  name: string;
  options: SupplierMergeOptions;
}) {
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const requestKey = useRef('');
  const target = options.others.find((supplier) => supplier.id === targetId);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setTargetId('');
      setReason('');
      setError(null);
      requestKey.current = newRequestKey();
    }
  }

  function merge() {
    if (!target) return;
    setError(null);
    startTransition(async () => {
      // Opens the kept supplier when it succeeds; only a failure comes back.
      const result = await mergeSupplierAction(supplierId, {
        targetId: target.id,
        reason: reason.trim(),
        requestKey: requestKey.current,
      });
      if (result && !result.ok) setError(result.error ?? 'The suppliers could not be merged.');
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
          <DialogTitle>Merge {name} into another supplier</DialogTitle>
          <DialogDescription>
            For a supplier entered twice. Everything on this record — {describe(options)}, with
            their deliveries, payments and bills — moves to the supplier you keep, and this record
            is archived. What is owed moves with the purchases.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Which supplier do you keep?</span>
            <NativeSelect
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
              className="h-11"
            >
              <option value="" disabled>
                Choose…
              </option>
              {options.others.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                  {supplier.taxNumber ? ` · TRN ${supplier.taxNumber}` : ''}
                </option>
              ))}
            </NativeSelect>
          </label>

          {target ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{name}</span>
                <span className="block truncate text-xs text-muted-foreground">archived</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 text-right">
                <span className="block truncate font-medium">{target.name}</span>
                <span className="block truncate text-xs text-muted-foreground">kept</span>
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
              placeholder="e.g. Same supplier, entered once with its short name"
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
          <Button disabled={!target || isPending} onClick={merge}>
            {isPending ? <Loader2 className="animate-spin" /> : <Merge />}
            {isPending ? 'Merging…' : 'Merge suppliers'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
