'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormError, TextareaField, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import type { ActionResult } from '@/lib/errors';
import { updatePurchaseDetailsAction } from '@/app/(app)/inventory/actions';

const INPUT = '[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm';

/**
 * Corrects a received purchase's details — the supplier's invoice number, its
 * date, the due date and the notes. The lines and amounts stay as received.
 */
export function EditPurchaseDetailsButton({
  purchase,
  today,
}: {
  purchase: {
    id: string;
    purchaseNumber: string;
    supplierInvoiceNumber: string | null;
    /** "YYYY-MM-DD". */
    supplierInvoiceDate: string | null;
    dueDate: string | null;
    notes: string | null;
  };
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await updatePurchaseDetailsAction(purchase.id, prev, formData);
      if (result.ok) {
        toast.success('Purchase details updated');
        router.refresh();
        setOpen(false);
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="lg" onClick={() => setOpen(true)}>
        <Pencil />
        Edit details
      </Button>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{purchase.purchaseNumber} — details</DialogTitle>
          <DialogDescription>
            The supplier&apos;s invoice number, its date, the due date and notes. The parts and
            amounts stay as received, and the books keep the day the goods arrived.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              label="Supplier invoice no."
              name="supplierInvoiceNumber"
              defaultValue={purchase.supplierInvoiceNumber ?? ''}
              error={errors.supplierInvoiceNumber}
              className={INPUT}
            />
            <TextField
              label="Purchase date"
              name="supplierInvoiceDate"
              type="date"
              max={today}
              defaultValue={purchase.supplierInvoiceDate ?? ''}
              error={errors.supplierInvoiceDate}
              hint="The date on the supplier's bill."
              className={INPUT}
            />
            <TextField
              label="Due date"
              name="dueDate"
              type="date"
              defaultValue={purchase.dueDate ?? ''}
              error={errors.dueDate}
              hint="Optional: when the supplier expects to be paid."
              className={INPUT}
            />
          </div>
          <TextareaField
            label="Notes"
            name="notes"
            defaultValue={purchase.notes ?? ''}
            error={errors.notes}
            className="[&_textarea]:min-h-16"
          />
          <FormError message={Object.keys(errors).length ? undefined : state.error} />
          <div className="border-t border-border pt-4">
            <SubmitButton pending={isPending} size="lg" className="h-11" pendingLabel="Saving…">
              <Save />
              Save details
            </SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
