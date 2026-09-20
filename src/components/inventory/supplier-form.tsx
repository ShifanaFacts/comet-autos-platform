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

const INPUT = '[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm';

export function SupplierForm({
  action,
  initial,
  cancelHref,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  initial?: {
    name: string;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    isActive: boolean;
  };
  cancelHref: string;
}) {
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(action, { ok: false });
  const errors = state.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <TextField
        label="Supplier name"
        name="name"
        required
        defaultValue={initial?.name}
        error={errors.name}
        autoFocus={!initial}
        className={INPUT}
      />
      <div className="grid gap-6 sm:grid-cols-2">
        <TextField
          label="Contact person"
          name="contactName"
          defaultValue={initial?.contactName ?? ''}
          error={errors.contactName}
          className={INPUT}
        />
        <TextField
          label="Phone"
          name="phone"
          type="tel"
          defaultValue={initial?.phone ?? ''}
          error={errors.phone}
          placeholder="04 123 4567"
          className={INPUT}
        />
        <TextField
          label="Email"
          name="email"
          type="email"
          defaultValue={initial?.email ?? ''}
          error={errors.email}
          className={INPUT}
        />
        {initial ? (
          <Field
            label="Status"
            htmlFor="isActive"
            hint="Inactive suppliers can't be used on new purchases."
          >
            <NativeSelect
              id="isActive"
              name="isActive"
              defaultValue={initial.isActive ? 'true' : 'false'}
              className="h-11 text-base md:text-sm"
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </NativeSelect>
          </Field>
        ) : null}
      </div>
      <TextareaField
        label="Address"
        name="address"
        defaultValue={initial?.address ?? ''}
        error={errors.address}
        className="[&_textarea]:min-h-16"
      />
      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <div className="flex flex-wrap gap-3 border-t border-border pt-6">
        <SubmitButton pending={isPending} size="lg" className="h-11" pendingLabel="Saving…">
          {initial ? 'Save changes' : 'Add supplier'}
        </SubmitButton>
        <LinkButton href={cancelHref} variant="outline" size="lg" className="h-11">
          Cancel
        </LinkButton>
      </div>
    </form>
  );
}
