'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FormError, NativeSelect, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import type { ActionResult } from '@/lib/errors';
import type { TaxCodeRow } from '@/lib/accounting/tax-codes';
import { VAT_TREATMENTS } from '@/lib/vat-treatment';
import { createTaxCodeAction, updateTaxCodeAction } from '@/app/(app)/finance/accounting/actions';

const INPUT = '[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm';

/** Adds a code, or edits one when `code` is given. */
function TaxCodeForm({ code, onDone }: { code?: TaxCodeRow; onDone?: () => void }) {
  const router = useRouter();
  const [treatment, setTreatment] = useState(code?.treatment ?? 'STANDARD');
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = code
        ? await updateTaxCodeAction(code.id, prev, formData)
        : await createTaxCodeAction(prev, formData);
      if (result.ok) {
        toast.success(code ? 'Tax code updated' : 'Tax code added');
        router.refresh();
        onDone?.();
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};
  const id = (name: string) => (code ? `${name}-${code.id}` : name);
  const zero = treatment !== 'STANDARD';

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="grid gap-6 sm:grid-cols-[8rem_1fr]">
        <TextField
          label="Code"
          id={id('code')}
          name="code"
          required
          defaultValue={code?.code}
          placeholder="e.g. SR"
          error={errors.code}
          className={`${INPUT} [&_input]:font-mono [&_input]:uppercase`}
        />
        <TextField
          label="Name"
          id={id('name')}
          name="name"
          required
          defaultValue={code?.name}
          placeholder="e.g. Standard rated"
          error={errors.name}
          className={INPUT}
        />
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          label="VAT return treatment"
          htmlFor={id('treatment')}
          error={errors.treatment}
          hint={code?.isSystem ? 'A standard code keeps its treatment.' : undefined}
        >
          <NativeSelect
            id={id('treatment')}
            name="treatment"
            value={treatment}
            disabled={code?.isSystem}
            onChange={(event) => setTreatment(event.target.value as typeof treatment)}
            className="h-11 text-base md:text-sm"
          >
            {VAT_TREATMENTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
          {code?.isSystem ? <input type="hidden" name="treatment" value={treatment} /> : null}
        </Field>
        <TextField
          key={zero ? 'zero' : 'rate'}
          label="Rate %"
          id={id('rate')}
          name="rate"
          numeric="rate"
          required
          readOnly={zero}
          defaultValue={zero ? '0' : (code?.rate.replace(/\.?0+$/, '') ?? '5')}
          hint={
            zero
              ? 'Always 0% for this treatment.'
              : code?.isSystem
                ? 'The standard rate — changing it changes Settings too.'
                : undefined
          }
          error={errors.rate}
          className={`${INPUT} [&_input]:text-right [&_input]:tabular-nums`}
        />
      </div>
      <fieldset className="flex flex-col gap-3 text-sm">
        <legend className="mb-2 text-sm font-medium">Offer it on</legend>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            name="forSales"
            defaultChecked={code?.forSales ?? true}
            className="size-4 accent-primary"
          />
          Sales — quotations and invoices
        </label>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            name="forPurchases"
            defaultChecked={code?.forPurchases ?? true}
            className="size-4 accent-primary"
          />
          Purchases and expenses
        </label>
        {errors.forSales ? <p className="text-xs text-destructive">{errors.forSales}</p> : null}
      </fieldset>
      <fieldset className="flex flex-col gap-3 text-sm">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            name="isDefault"
            defaultChecked={code?.isDefault}
            className="size-4 accent-primary"
          />
          The default for new lines
        </label>
        {code ? (
          <label className="flex items-center gap-3">
            {/* Unticked sends only "false"; ticked, the box's "true" comes last and wins. */}
            <input type="hidden" name="isActive" value="false" />
            <input
              type="checkbox"
              name="isActive"
              value="true"
              defaultChecked={code.isActive}
              className="size-4 accent-primary"
            />
            In use — offered on new lines
          </label>
        ) : null}
        {errors.isActive ? <p className="text-xs text-destructive">{errors.isActive}</p> : null}
      </fieldset>
      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <div className="border-t border-border pt-4">
        <SubmitButton pending={isPending} size="lg" className="h-11" pendingLabel="Saving…">
          {code ? <Save /> : <Plus />}
          {code ? 'Save changes' : 'Add tax code'}
        </SubmitButton>
      </div>
    </form>
  );
}

export function NewTaxCodeForm() {
  return <TaxCodeForm />;
}

export function EditTaxCodeButton({ code }: { code: TaxCodeRow }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        className="h-11 text-muted-foreground sm:h-8"
        onClick={() => setOpen(true)}
        aria-label={`Edit ${code.code}`}
      >
        <Pencil />
        Edit
      </Button>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {code.code} — {code.name}
          </DialogTitle>
          <DialogDescription>
            Changes apply to lines saved from now on. Documents already issued keep the rate they
            were priced at.
          </DialogDescription>
        </DialogHeader>
        <TaxCodeForm code={code} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
