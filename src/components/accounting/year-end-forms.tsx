'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarCheck2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormError } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { ReasonAction } from '@/components/shared/reason-action';
import type { ActionResult } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import {
  closeFinancialYearAction,
  reopenFinancialYearAction,
} from '@/app/(app)/finance/accounting/actions';

/** Confirms and books the closing entry for the year shown. */
export function CloseYearButton({ yearEnd, profit }: { yearEnd: string; profit: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    async (prev, formData) => {
      const result = await closeFinancialYearAction(prev, formData);
      if (result.ok) {
        toast.success('Financial year closed');
        setOpen(false);
        router.refresh();
      }
      return result;
    },
    { ok: false },
  );
  const loss = profit.startsWith('-');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="lg" className="h-11" onClick={() => setOpen(true)}>
        <CalendarCheck2 />
        Close the year
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close the financial year ended {yearEnd}?</DialogTitle>
          <DialogDescription>
            Every income and expense account is brought to zero and the {loss ? 'loss' : 'profit'}{' '}
            of {formatMoney(loss ? profit.slice(1) : profit)} moves to retained earnings, in one
            journal entry dated {yearEnd}. The year&apos;s profit and loss still reports what it
            earned.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <input type="hidden" name="yearEnd" value={yearEnd} />
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="lockBooks"
              defaultChecked
              className="mt-0.5 size-4 accent-primary"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">Close the books through {yearEnd}</span>
              <span className="text-xs text-muted-foreground">
                Recommended. Nothing can then be booked in the closed year, so its income and
                expense accounts stay at zero.
              </span>
            </span>
          </label>
          <FormError message={state.error} />
          <SubmitButton pending={isPending} size="lg" className="h-11" pendingLabel="Closing…">
            Close the year
          </SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ReopenYearButton({ entryId, yearEnd }: { entryId: string; yearEnd: string }) {
  return (
    <ReasonAction
      trigger={
        <Button variant="outline" size="sm" className="h-11 sm:h-8">
          <RotateCcw />
          Reopen
        </Button>
      }
      title={`Reopen the year ended ${yearEnd}?`}
      description="The closing entry is reversed, so the year's income and expenses show again until it is closed once more. The books' lock is not changed."
      confirmLabel="Reopen the year"
      placeholder="e.g. An audit adjustment has to go into that year"
      successMessage="Year reopened"
      onConfirm={(input) => reopenFinancialYearAction(entryId, input)}
    />
  );
}
