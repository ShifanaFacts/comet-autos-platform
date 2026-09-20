'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormError, TextareaField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import type { ActionResult } from '@/lib/errors';
import { voidExpenseAction } from '@/app/(app)/finance/actions';

/**
 * Cancels an expense without destroying it: the record stays, marked void,
 * with the reason in the audit log. A month's spend can always be explained.
 */
export function VoidExpenseButton({
  expenseId,
  description,
}: {
  expenseId: string;
  description: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await voidExpenseAction(expenseId, prev, formData);
      if (result.ok) {
        toast.success('Expense voided');
        setOpen(false);
        startTransition(() => router.refresh());
      }
      return result;
    },
    { ok: false },
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        className="h-11 text-muted-foreground sm:h-8"
        onClick={() => setOpen(true)}
      >
        <Ban />
        Void
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void this expense?</DialogTitle>
          <DialogDescription>
            “{description}” stops counting towards the workshop&apos;s spend. The record is kept
            with your reason, so the month can still be explained.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <TextareaField
            label="Why is it being voided?"
            name="reason"
            required
            placeholder="e.g. Entered twice by mistake"
            error={state.fieldErrors?.reason}
            className="[&_textarea]:min-h-20 [&_textarea]:text-base md:[&_textarea]:text-sm"
          />
          <FormError message={state.fieldErrors?.reason ? undefined : state.error} />
          <div className="grid gap-2 sm:grid-cols-2">
            <SubmitButton
              pending={isPending}
              variant="destructive"
              size="lg"
              className="h-11"
              pendingLabel="Voiding…"
            >
              {isPending ? <Loader2 className="animate-spin" /> : <Ban />}
              Void expense
            </SubmitButton>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="h-11"
              onClick={() => setOpen(false)}
            >
              Keep it
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
