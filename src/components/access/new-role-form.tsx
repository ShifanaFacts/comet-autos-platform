'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Field, FormError, NativeSelect, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { InlineForm } from '@/components/shared/inline-form';
import type { ActionResult } from '@/lib/errors';
import { ROLE_PRESETS } from '@/lib/auth/permission-catalog';
import { createRoleAction } from '@/app/(app)/settings/users/actions';

/**
 * Creating a role: a name, and optionally a preset to start the ticks from.
 * The next screen is the grid, where the admin adjusts them. With no preset
 * the role starts with nothing at all — a role that grants nothing is
 * harmless.
 */
export function NewRoleForm() {
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(createRoleAction, { ok: false });
  const errors = state.fieldErrors ?? {};
  const [preset, setPreset] = useState('');
  const chosen = ROLE_PRESETS.find((option) => option.key === preset);

  return (
    <InlineForm
      label="Create a role"
      icon={<Plus className="size-4" />}
      hint="Name it after the job someone does, pick a starting point, then adjust the ticks."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <TextField
          label="Role name"
          name="name"
          required
          error={errors.name}
          placeholder="e.g. Receptionist"
          className="[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm"
        />
        <TextField
          label="Description"
          name="description"
          error={errors.description}
          hint="Optional. What this role is for."
          className="[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm"
        />
        <Field
          label="Start from"
          htmlFor="role-preset"
          error={errors.preset}
          hint={
            chosen
              ? `${chosen.description} ${chosen.codes.length} permissions — you can change any of them next.`
              : 'Nothing ticked. You choose every permission on the next screen.'
          }
        >
          <NativeSelect
            id="role-preset"
            name="preset"
            value={preset}
            onChange={(event) => setPreset(event.target.value)}
            className="h-11 text-base md:text-sm"
          >
            <option value="">Blank — nothing ticked</option>
            {ROLE_PRESETS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <FormError message={Object.keys(errors).length ? undefined : state.error} />
        <SubmitButton pending={isPending} className="h-12 sm:h-11" pendingLabel="Creating…">
          <Plus />
          Create role
        </SubmitButton>
      </form>
    </InlineForm>
  );
}
