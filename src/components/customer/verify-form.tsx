'use client';

import { Lock, ShieldCheck } from 'lucide-react';
import { FormError, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import type { ActionResult } from '@/lib/errors';

/** "Confirm it's you": registration + mobile number before any customer document is shown. */
export function VerifyForm({
  action,
  documentName,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  documentName: string;
}) {
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(action, { ok: false });
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ShieldCheck className="size-5" />
        </span>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Confirm it&apos;s you</h1>
        <p className="text-muted-foreground">
          To protect your details, enter your vehicle registration and mobile number to view your{' '}
          {documentName}.
        </p>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <TextField
          label="Vehicle registration"
          name="plateNumber"
          required
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="e.g. A 12345"
          className="[&_input]:h-12 [&_input]:text-base"
        />
        <TextField
          label="Mobile number"
          name="phone"
          type="tel"
          required
          autoComplete="tel"
          inputMode="tel"
          placeholder="e.g. 050 123 4567"
          hint="The number you gave the workshop."
          className="[&_input]:h-12 [&_input]:text-base"
        />
        <FormError message={state.error} />
        <SubmitButton
          pending={isPending}
          size="lg"
          className="h-12 w-full text-base"
          pendingLabel="Checking…"
        >
          <Lock />
          View my {documentName}
        </SubmitButton>
      </form>
    </div>
  );
}
