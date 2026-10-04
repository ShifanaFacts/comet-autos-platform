'use client';

import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import type { ActionResult } from '@/lib/errors';
import { resetEmployeeLoginAction } from '@/app/(app)/hr/actions';

/** Puts the login's password back on the employee code; asks once before doing it. */
export function ResetLoginButton({ employeeId }: { employeeId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async () => {
      const result = await resetEmployeeLoginAction(employeeId);
      if (result.ok) {
        toast.success('Password reset to their employee code. They choose a new one at sign-in.');
        setConfirming(false);
      }
      return result;
    },
    { ok: false },
  );

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2 self-start"
        onClick={() => setConfirming(true)}
      >
        <KeyRound />
        Reset password to employee code
      </Button>
    );
  }
  return (
    <form onSubmit={onSubmit} className="mt-2 flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        They will be signed out everywhere and sign in again with their employee code as the
        password, then choose a new one.
      </p>
      <div className="flex flex-wrap gap-2">
        <SubmitButton pending={isPending} size="sm" pendingLabel="Resetting…">
          Reset password
        </SubmitButton>
        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
      <FormError message={state.error} />
    </form>
  );
}
