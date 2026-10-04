'use client';

import { Save } from 'lucide-react';
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
import type { ActionResult } from '@/lib/errors';
import { quickCreateSupplierAction } from '@/app/(app)/inventory/actions';

const INPUT = '[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm';

export interface SupplierChoice {
  id: string;
  name: string;
}

/**
 * A supplier not on file yet, added from a supplier list without leaving
 * the page: the name, and the phone and TRN when to hand. The rest (email,
 * address) can be filled in later on the supplier's page.
 */
export function NewSupplierDialog({
  name,
  onClose,
  onCreated,
}: {
  /** What was typed in the list's search, to start the name with. */
  name: string;
  onClose: () => void;
  onCreated: (supplier: SupplierChoice) => void;
}) {
  const [state, onSubmit, isPending] = useFormAction<ActionResult<SupplierChoice>>(
    async (prev, formData) => {
      const result = await quickCreateSupplierAction(prev, formData);
      if (result.ok && result.data) {
        toast.success(`${result.data.name} added to your suppliers`);
        onCreated(result.data);
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a new supplier</DialogTitle>
          <DialogDescription>It is saved to your suppliers and chosen here.</DialogDescription>
        </DialogHeader>
        {/* Inside another form on the page's component tree: its keys and submit stop here. */}
        <form
          onSubmit={(event) => {
            event.stopPropagation();
            onSubmit(event);
          }}
          onKeyDown={(event) => event.stopPropagation()}
          className="flex flex-col gap-5"
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              id="new-supplier-name"
              label="Supplier name"
              name="name"
              required
              autoFocus
              defaultValue={name}
              error={errors.name}
              className={`${INPUT} sm:col-span-2`}
            />
            <TextField
              id="new-supplier-phone"
              label="Phone"
              name="phone"
              type="tel"
              error={errors.phone}
              className={INPUT}
            />
            <TextField
              id="new-supplier-trn"
              label="TRN"
              name="taxNumber"
              inputMode="numeric"
              error={errors.taxNumber}
              hint="15 digits, as on their tax invoice."
              className={INPUT}
            />
            <TextField
              id="new-supplier-contact"
              label="Contact person"
              name="contactName"
              error={errors.contactName}
              className={`${INPUT} sm:col-span-2`}
            />
          </div>
          <FormError message={state.error} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" size="lg" onClick={onClose}>
              Cancel
            </Button>
            <SubmitButton size="lg" pending={isPending} pendingLabel="Adding…">
              <Save />
              Add supplier
            </SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
