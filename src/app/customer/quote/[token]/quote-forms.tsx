'use client';

import { useFormAction } from '@/components/forms/use-form-action';
import { useState } from 'react';
import { CheckCircle2, Lock, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormError, TextField, TextareaField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import type { ActionResult } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { decideQuoteAction, verifyQuoteAction } from './actions';

export function VerifyForm({ token }: { token: string }) {
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(verifyQuoteAction.bind(null, token), { ok: false });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <TextField
        label="Vehicle registration"
        name="plateNumber"
        required
        autoComplete="off"
        autoCapitalize="characters"
        placeholder="e.g. A 12345"
        className="[&_input]:h-11 [&_input]:text-base"
      />
      <TextField
        label="Mobile number"
        name="phone"
        type="tel"
        required
        autoComplete="tel"
        placeholder="e.g. 050 123 4567"
        hint="The number you gave Comet Autos."
        className="[&_input]:h-11 [&_input]:text-base"
      />
      <FormError message={state.error} />
      <SubmitButton pending={isPending} size="lg" className="h-11 w-full" pendingLabel="Checking…">
        <Lock />
        View my quotation
      </SubmitButton>
    </form>
  );
}

export function DecisionForm({ token, total }: { token: string; total: string }) {
  const [choice, setChoice] = useState<'APPROVED' | 'REJECTED' | null>(null);
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(decideQuoteAction.bind(null, token), { ok: false });

  if (!choice) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Button size="lg" className="h-12 text-base" onClick={() => setChoice('APPROVED')}>
          <CheckCircle2 />
          Approve quotation
        </Button>
        <Button size="lg" variant="outline" className="h-12 text-base" onClick={() => setChoice('REJECTED')}>
          <XCircle />
          Reject
        </Button>
      </div>
    );
  }

  const approving = choice === 'APPROVED';
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <input type="hidden" name="decision" value={choice} />
      <div className={cn('rounded-lg border px-4 py-4 text-sm', approving ? 'border-success/30 bg-success/5' : 'border-danger/30 bg-danger/5')}>
        {approving
          ? `By approving, you authorise Comet Autos to carry out the work listed for ${total}.`
          : 'Comet Autos will be told you do not want this work done. They may contact you with other options.'}
      </div>
      <TextareaField
        label={approving ? 'Anything we should know? (optional)' : 'Reason (optional)'}
        name="notes"
        maxLength={2000}
        placeholder={approving ? 'e.g. Please call me when the car is ready' : 'e.g. I would like a cheaper option for the parts'}
        className="[&_textarea]:text-base"
      />
      <FormError message={state.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SubmitButton
          pending={isPending}
          size="lg"
          variant={approving ? 'default' : 'destructive'}
          className="h-12 text-base"
          pendingLabel={approving ? 'Approving…' : 'Sending…'}
        >
          {approving ? 'Confirm approval' : 'Confirm rejection'}
        </SubmitButton>
        <Button type="button" size="lg" variant="ghost" className="h-12 text-base" onClick={() => setChoice(null)}>
          Go back
        </Button>
      </div>
    </form>
  );
}
