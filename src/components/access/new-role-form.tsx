'use client';

import { Plus } from 'lucide-react';
import { FormError, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { InlineForm } from '@/components/shared/inline-form';
import type { ActionResult } from '@/lib/errors';
import { createRoleAction } from '@/app/(app)/settings/users/actions';

/**
 * Creating a role is the small half of the job — it starts with no
 * permissions at all, and the next screen is where they are chosen. That
 * order is deliberate: a role that exists but grants nothing is harmless.
 */
export function NewRoleForm() {
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(createRoleAction, { ok: false });
  const errors = state.fieldErrors ?? {};

  return (
    <InlineForm
      label="Create a role"
      icon={<Plus className="size-4" />}
      hint="Name it after the job someone does, then choose what it allows."
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
        <FormError message={Object.keys(errors).length ? undefined : state.error} />
        <SubmitButton pending={isPending} className="h-12 sm:h-11" pendingLabel="Creating…">
          <Plus />
          Create role
        </SubmitButton>
      </form>
    </InlineForm>
  );
}
