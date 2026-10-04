'use client';

import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { Field, FormError, NativeSelect, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import type { ActionResult } from '@/lib/errors';
import { createDesignationAction, updateDesignationAction } from '@/app/(app)/hr/actions';

const INPUT = '[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm';

/** A new designation; its permissions start from a preset and are ticked on its page. */
export function NewDesignationForm({ presets }: { presets: { key: string; label: string }[] }) {
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(createDesignationAction, {
    ok: false,
  });
  const errors = state.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          label="Designation"
          name="name"
          required
          error={errors.name}
          placeholder="e.g. Technician"
          hint="If a role of the same name already exists, its permissions are used."
          className={INPUT}
        />
        <Field
          label="Start permissions from"
          htmlFor="preset"
          error={errors.preset}
          hint="You tick exactly what it may do on the next page."
        >
          <NativeSelect id="preset" name="preset" defaultValue="" className="h-11 text-base md:text-sm">
            <option value="">Nothing — I’ll tick them</option>
            {presets.map((preset) => (
              <option key={preset.key} value={preset.key}>
                {preset.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <TextField
        label="Description"
        name="description"
        error={errors.description}
        hint="Optional — what this position does."
        className={INPUT}
      />
      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <div>
        <SubmitButton pending={isPending} size="lg" className="h-11" pendingLabel="Creating…">
          Create designation
        </SubmitButton>
      </div>
    </form>
  );
}

/** Renames a designation, changes its description or retires it. */
export function EditDesignationForm({
  designation,
}: {
  designation: { id: string; name: string; description: string | null; isActive: boolean };
}) {
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await updateDesignationAction(designation.id, prev, formData);
      if (result.ok) toast.success('Designation saved');
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          label="Designation"
          name="name"
          required
          defaultValue={designation.name}
          error={errors.name}
          hint="Renaming it renames its role and everyone’s job title."
          className={INPUT}
        />
        <Field
          label="Status"
          htmlFor="isActive"
          hint="An inactive designation is no longer offered for new employees."
        >
          <NativeSelect
            id="isActive"
            name="isActive"
            defaultValue={designation.isActive ? 'true' : 'false'}
            className="h-11 text-base md:text-sm"
          >
            <option value="true">In use</option>
            <option value="false">Inactive</option>
          </NativeSelect>
        </Field>
      </div>
      <TextField
        label="Description"
        name="description"
        defaultValue={designation.description ?? ''}
        error={errors.description}
        className={INPUT}
      />
      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <div>
        <SubmitButton pending={isPending} size="lg" className="h-11" pendingLabel="Saving…">
          <Save />
          Save
        </SubmitButton>
      </div>
    </form>
  );
}
