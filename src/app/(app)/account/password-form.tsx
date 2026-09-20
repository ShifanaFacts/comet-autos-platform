'use client';

import { useRef } from 'react';
import { KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { FormError, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import type { ActionResult } from '@/lib/errors';
import { changePasswordAction } from './actions';

const INPUT = '[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm';

export function PasswordForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await changePasswordAction(prev, formData);
      if (result.ok) {
        toast.success('Password changed. Any other devices have been signed out.');
        formRef.current?.reset();
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-5">
      <TextField
        label="Current password"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
        error={errors.currentPassword}
        className={INPUT}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          label="New password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          error={errors.newPassword}
          hint="At least 8 characters, with a letter and a number."
          className={INPUT}
        />
        <TextField
          label="Confirm new password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          error={errors.confirmPassword}
          className={INPUT}
        />
      </div>
      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <SubmitButton
        pending={isPending}
        size="lg"
        className="h-11 self-start"
        pendingLabel="Changing…"
      >
        <KeyRound />
        Change password
      </SubmitButton>
    </form>
  );
}
