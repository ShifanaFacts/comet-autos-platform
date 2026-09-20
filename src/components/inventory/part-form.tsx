'use client';

import {
  Field,
  FormError,
  NativeSelect,
  TextField,
  TextareaField,
} from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { LinkButton } from '@/components/shared/link-button';
import type { ActionResult } from '@/lib/errors';

export interface PartFormValues {
  sku: string;
  name: string;
  category: string;
  description: string;
  preferredSupplierId: string;
  unitOfMeasure: string;
  costPrice: string;
  sellingPrice: string;
  taxRate: string;
  reorderLevel: string;
  isActive: boolean;
}

const UNITS = ['piece', 'set', 'pair', 'litre', 'bottle', 'kg', 'metre', 'box'];
const INPUT = '[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm';

/** Catalogue details for a part. Opening stock only on a new part — after that stock moves through the ledger. */
export function PartForm({
  action,
  initial,
  categories,
  suppliers,
  defaultVat,
  isNew,
  cancelHref,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  initial?: PartFormValues;
  categories: string[];
  suppliers: { id: string; name: string }[];
  defaultVat: string;
  isNew: boolean;
  cancelHref: string;
}) {
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(action, { ok: false });
  const errors = state.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8">
      <fieldset className="flex flex-col gap-6">
        <legend className="mb-4 text-sm font-semibold">Part</legend>
        <div className="grid gap-6 sm:grid-cols-2">
          <TextField
            label="Part number / SKU"
            name="sku"
            required
            defaultValue={initial?.sku}
            error={errors.sku}
            autoFocus={isNew}
            autoCapitalize="characters"
            hint="Stored in capitals. Must be unique."
            className={`${INPUT} [&_input]:font-mono`}
          />
          <TextField
            label="Part name"
            name="name"
            required
            defaultValue={initial?.name}
            error={errors.name}
            className={INPUT}
          />
          <TextField
            label="Category"
            name="category"
            list="part-categories"
            defaultValue={initial?.category}
            error={errors.category}
            hint="Pick an existing one or type a new one."
            className={INPUT}
          />
          <datalist id="part-categories">
            {categories.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
          <Field
            label="Supplier"
            htmlFor="preferredSupplierId"
            error={errors.preferredSupplierId}
            hint="Where you usually buy it."
          >
            <NativeSelect
              id="preferredSupplierId"
              name="preferredSupplierId"
              defaultValue={initial?.preferredSupplierId ?? ''}
              className="h-11 text-base md:text-sm"
            >
              <option value="">No preferred supplier</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <TextareaField
          label="Description"
          name="description"
          defaultValue={initial?.description}
          error={errors.description}
          hint="Optional — fitment, brand, specification."
          className="[&_textarea]:min-h-16"
        />
      </fieldset>

      <fieldset className="flex flex-col gap-6 border-t border-border pt-8">
        <legend className="mb-4 text-sm font-semibold">Pricing</legend>
        <div className="grid gap-6 sm:grid-cols-3">
          <TextField
            label="Cost price (AED)"
            name="costPrice"
            required
            inputMode="decimal"
            defaultValue={initial?.costPrice}
            error={errors.costPrice}
            className={INPUT}
          />
          <TextField
            label="Selling price (AED)"
            name="sellingPrice"
            required
            inputMode="decimal"
            defaultValue={initial?.sellingPrice}
            error={errors.sellingPrice}
            className={INPUT}
          />
          <TextField
            label="VAT %"
            name="taxRate"
            inputMode="decimal"
            defaultValue={initial?.taxRate || defaultVat}
            error={errors.taxRate}
            className={INPUT}
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-6 border-t border-border pt-8">
        <legend className="mb-4 text-sm font-semibold">Stock</legend>
        <div className="grid gap-6 sm:grid-cols-3">
          <TextField
            label="Unit"
            name="unitOfMeasure"
            required
            list="part-units"
            defaultValue={initial?.unitOfMeasure ?? 'piece'}
            error={errors.unitOfMeasure}
            className={INPUT}
          />
          <datalist id="part-units">
            {UNITS.map((unit) => (
              <option key={unit} value={unit} />
            ))}
          </datalist>
          <TextField
            label="Minimum stock"
            name="reorderLevel"
            inputMode="decimal"
            defaultValue={initial?.reorderLevel}
            error={errors.reorderLevel}
            hint="Shown as low stock at or below this."
            className={INPUT}
          />
          {isNew ? (
            <TextField
              label="Opening stock"
              name="openingStock"
              inputMode="decimal"
              error={errors.openingStock}
              hint="Quantity on the shelf today. Leave empty if none."
              className={INPUT}
            />
          ) : (
            <Field
              label="Status"
              htmlFor="isActive"
              hint="Inactive parts can't be issued or purchased."
            >
              <NativeSelect
                id="isActive"
                name="isActive"
                defaultValue={initial?.isActive === false ? 'false' : 'true'}
                className="h-11 text-base md:text-sm"
              >
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </NativeSelect>
            </Field>
          )}
        </div>
        {!isNew ? (
          <p className="text-sm text-muted-foreground">
            Stock can&apos;t be edited here — use “Adjust stock” on the part, so every change is recorded
            with a reason.
          </p>
        ) : null}
      </fieldset>

      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <div className="flex flex-wrap gap-3 border-t border-border pt-6">
        <SubmitButton pending={isPending} size="lg" className="h-11" pendingLabel="Saving…">
          {isNew ? 'Add part' : 'Save changes'}
        </SubmitButton>
        <LinkButton href={cancelHref} variant="outline" size="lg" className="h-11">
          Cancel
        </LinkButton>
      </div>
    </form>
  );
}
