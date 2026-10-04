'use client';

import { FormError, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import type { ActionResult } from '@/lib/errors';
import { setOwnPasswordAction } from './actions';

const INPUT = '[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm';

export function SetPasswordForm() {
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(setOwnPasswordAction, {
    ok: false,
  });
  const errors = state.fieldErrors ?? {};

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <TextField
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        autoFocus
        error={errors.newPassword}
        hint="At least 8 characters, with a letter and a number."
        className={INPUT}
      />
      <TextField
        label="Type it again"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        error={errors.confirmPassword}
        className={INPUT}
      />
      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <SubmitButton pending={isPending} size="lg" className="h-11" pendingLabel="Saving…">
        Save and continue
      </SubmitButton>
    </form>
  );
}
