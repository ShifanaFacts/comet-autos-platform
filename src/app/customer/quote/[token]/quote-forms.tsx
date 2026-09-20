'use client';

import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormError, TextareaField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { SignaturePad } from '@/components/media/signature-pad';
import type { ActionResult } from '@/lib/errors';
import { decideQuoteAction } from './actions';

/**
 * Approve / Reject for the customer. On phones the two buttons sit in a bar
 * pinned to the bottom of the screen, always within thumb reach. Each opens
 * a short confirmation (approval authorises the spend; rejection is final)
 * with an optional note.
 */
export function DecisionBar({
  token,
  total,
  quotationNumber,
}: {
  token: string;
  total: string;
  quotationNumber: string;
}) {
  const [choice, setChoice] = useState<'APPROVED' | 'REJECTED' | null>(null);
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await decideQuoteAction(token, prev, formData);
      if (result.ok) {
        toast.success(
          formData.get('decision') === 'APPROVED'
            ? 'Quotation approved successfully.'
            : 'Quotation rejected.',
        );
        setChoice(null);
      }
      return result;
    },
    { ok: false },
  );
  const approving = choice === 'APPROVED';

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:pb-0 sm:backdrop-blur-none">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-3 px-4 py-3 sm:px-0 sm:py-0">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Button size="lg" className="h-12 text-base" onClick={() => setChoice('APPROVED')}>
              <CheckCircle2 />
              Approve quotation
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-12 px-5 text-base"
              onClick={() => setChoice('REJECTED')}
            >
              <XCircle />
              Reject
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={choice !== null} onOpenChange={(open) => !open && setChoice(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {approving ? `Approve ${quotationNumber}?` : 'Reject this quotation?'}
            </DialogTitle>
            <DialogDescription>
              {approving
                ? `You authorise the workshop to carry out the work listed for ${total}. Any extra work will be quoted to you separately.`
                : 'The workshop will be told you do not want this work done. They may contact you with other options.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="flex flex-col gap-5">
            <input type="hidden" name="decision" value={choice ?? ''} />
            <TextareaField
              label={approving ? 'Anything we should know? (optional)' : 'Reason (optional)'}
              name="notes"
              maxLength={2000}
              placeholder={
                approving
                  ? 'e.g. Please call me when the car is ready'
                  : 'e.g. I would like a cheaper option for the parts'
              }
              className="[&_textarea]:min-h-20 [&_textarea]:text-base"
            />
            {approving ? (
              <SignaturePad
                label="Sign to confirm (optional)"
                optionalNote="You can approve without signing."
              />
            ) : null}
            <FormError message={state.error} />
            <div className="grid gap-2 sm:grid-cols-2">
              <SubmitButton
                pending={isPending}
                size="lg"
                variant={approving ? 'default' : 'destructive'}
                className="h-12 text-base"
                pendingLabel={approving ? 'Approving…' : 'Rejecting…'}
              >
                {approving ? 'Approve quotation' : 'Reject quotation'}
              </SubmitButton>
              <Button
                type="button"
                size="lg"
                variant="ghost"
                className="h-12 text-base"
                onClick={() => setChoice(null)}
              >
                Go back
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
