'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, Power, PowerOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmAction } from '@/components/shared/confirm-action';
import { FormError, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import type { ActionResult } from '@/lib/errors';
import { resetPasswordAction, setUserActiveAction } from '@/app/(app)/settings/users/actions';

/*
 * The two things an administrator does to an account that is not simply
 * being edited: stop it working, and give it a new password.
 *
 * Both are confirmed first and both are refused by the server in the cases
 * that would hurt the workshop — deactivating yourself, or removing the last
 * person who can manage access. The buttons below are convenience; the
 * service is the boundary.
 */

export function UserAccountActions({
  userId,
  name,
  isActive,
  isSelf,
}: {
  userId: string;
  name: string;
  isActive: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [isSwitching, startSwitching] = useTransition();
  const [resetting, setResetting] = useState(false);
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await resetPasswordAction(userId, prev, formData);
      if (result.ok) {
        toast.success(`New password set for ${name}. They are signed out everywhere.`);
        setResetting(false);
        router.refresh();
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};

  function setActive(next: boolean) {
    startSwitching(async () => {
      const result = await setUserActiveAction(userId, next);
      if (!result.ok) {
        toast.error(result.error ?? 'That change could not be made.');
        return;
      }
      toast.success(next ? `${name} can sign in again` : `${name} can no longer sign in`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row">
        {isActive ? (
          <ConfirmAction
            trigger={
              <Button
                variant="outline"
                className="h-12 w-full text-danger sm:h-11 sm:w-auto"
                disabled={isSwitching || isSelf}
              >
                {isSwitching ? <Loader2 className="animate-spin" /> : <PowerOff />}
                Deactivate
              </Button>
            }
            title={`Stop ${name} signing in?`}
            description="They are signed out straight away and cannot sign in again until reactivated. Everything they have already done stays on record."
            confirmLabel="Deactivate account"
            onConfirm={async () => setActive(false)}
          />
        ) : (
          <Button
            variant="outline"
            className="h-12 w-full sm:h-11 sm:w-auto"
            disabled={isSwitching}
            onClick={() => setActive(true)}
          >
            {isSwitching ? <Loader2 className="animate-spin" /> : <Power />}
            Reactivate
          </Button>
        )}

        <Button
          variant="outline"
          className="h-12 w-full sm:h-11 sm:w-auto"
          onClick={() => setResetting((open) => !open)}
          aria-expanded={resetting}
        >
          <KeyRound />
          Reset password
        </Button>
      </div>

      {isSelf ? (
        <p className="text-xs text-muted-foreground">
          This is your own account, so it can’t be deactivated here. Change your own password from
          your account page.
        </p>
      ) : null}

      {resetting ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-4 border-t border-border pt-5">
          <TextField
            label="New password"
            name="password"
            type="password"
            required
            autoComplete="new-password"
            error={errors.password}
            hint="At least 10 characters with a number. Give it to them in person — every device they are signed in on is signed out."
            className="[&_input]:h-11 [&_input]:text-base md:[&_input]:text-sm"
          />
          <FormError message={Object.keys(errors).length ? undefined : state.error} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <SubmitButton
              pending={isPending}
              className="h-12 sm:h-11"
              pendingLabel="Setting…"
            >
              <KeyRound />
              Set new password
            </SubmitButton>
            <Button
              type="button"
              variant="ghost"
              className="h-12 sm:h-11"
              onClick={() => setResetting(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
