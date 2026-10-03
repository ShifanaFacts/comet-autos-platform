'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Banknote, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FormError, TextField } from '@/components/forms/fields';
import { ReferenceField } from '@/components/forms/reference-field';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { Panel } from '@/components/layout/primitives';
import { TableWrap } from '@/components/shared/record-card';
import { ReasonAction } from '@/components/shared/reason-action';
import { PaymentModeField } from '@/components/accounting/payment-mode-field';
import { ExpenseBills } from '@/components/finance/expense-bills';
import { attachScannedBill } from '@/components/bill-reader/scan-bill';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import type { ActionResult } from '@/lib/errors';
import type { OwedToOwners } from '@/lib/finance/owner-payments';
import type { PaymentModeOption } from '@/lib/accounting/payment-modes';
import {
  reimburseOwnerAction,
  removeReimbursementFileAction,
  reverseOwnerReimbursementAction,
} from '@/app/(app)/finance/owner-advances/actions';

const FILES_PATH = '/finance/owner-advances';

/*
 * What the workshop owes the owner(s) who paid its bills with their own card
 * or cash: per person, every such bill and every reimbursement, newest first,
 * with the balance after each. Seeing it needs Accounts → View; reimbursing
 * needs Create, reversing Delete.
 */
export function OwedToOwnersPanel({
  data,
  files,
  billFiles,
  modes,
  today,
  canReimburse,
  canReverse,
  canRemoveFile,
}: {
  data: OwedToOwners;
  /** Files kept with each reimbursement, by its id. */
  files: Record<string, { id: string; fileName: string }[]>;
  /** The supplier's bill kept with each expense, by its id. */
  billFiles: Record<string, { id: string; fileName: string }[]>;
  modes: PaymentModeOption[];
  /** YYYY-MM-DD, the workshop's today. */
  today: string;
  canReimburse: boolean;
  canReverse: boolean;
  canRemoveFile: boolean;
}) {
  if (data.people.length === 0) {
    return (
      <Panel className="text-sm text-muted-foreground">
        Nobody holds the Owner role yet, so no bill can be paid personally.
      </Panel>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {data.people.map((person) => (
        <Panel key={person.id} padding="none" className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{person.name}</span>
              <span className="text-xs text-muted-foreground">
                Owed for bills paid personally — balance now
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xl font-semibold tabular-nums">{formatMoney(person.owed)}</span>
              {canReimburse && Number(person.owed) > 0 ? (
                <ReimburseButton
                  personId={person.id}
                  name={person.name}
                  owed={person.owed}
                  modes={modes}
                  today={today}
                />
              ) : null}
            </div>
          </div>
          {person.lines.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground sm:px-6">
              No bills paid personally yet.
            </p>
          ) : (
            <TableWrap>
              <table className="w-full min-w-180 text-sm">
                <thead className="bg-muted/40 text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                  <tr>
                    <th className="w-28 px-4 py-3 pl-6">Date</th>
                    <th className="px-2 py-3">What</th>
                    <th className="px-2 py-3">Supplier</th>
                    <th className="px-2 py-3">Bill no.</th>
                    <th className="w-28 px-2 py-3 text-right">Amount</th>
                    <th className="w-28 px-2 py-3 text-right">Balance</th>
                    <th className="px-4 py-3 pr-6" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {person.lines.map((line) => (
                    <tr key={`${line.kind}-${line.id}`}>
                      <td className="px-4 py-3 pl-6 tabular-nums whitespace-nowrap">
                        {formatCalendarDate(line.date)}
                      </td>
                      <td className="px-2 py-3">
                        {line.href ? (
                          <Link href={line.href} className="hover:text-primary hover:underline">
                            {line.description}
                          </Link>
                        ) : (
                          line.description
                        )}
                        {line.reference ? (
                          <span className="block text-xs text-muted-foreground">
                            Ref. {line.reference}
                          </span>
                        ) : null}
                        <span className="mt-1 block">
                          {line.kind === 'repayment' ? (
                            <ExpenseBills
                              expenseId={line.id}
                              bills={files[line.id] ?? []}
                              basePath={FILES_PATH}
                              removeAction={removeReimbursementFileAction}
                              canAttach={canReimburse}
                              canRemove={canRemoveFile}
                            />
                          ) : (billFiles[line.id] ?? []).length ? (
                            <ExpenseBills
                              expenseId={line.id}
                              bills={billFiles[line.id]}
                              canAttach={false}
                              canRemove={false}
                            />
                          ) : null}
                        </span>
                      </td>
                      <td className="px-2 py-3 text-muted-foreground">{line.supplier ?? '—'}</td>
                      <td className="px-2 py-3 text-muted-foreground">{line.billNumber ?? '—'}</td>
                      <td className="px-2 py-3 text-right tabular-nums whitespace-nowrap">
                        {formatMoney(line.amount)}
                      </td>
                      <td className="px-2 py-3 text-right font-medium tabular-nums whitespace-nowrap">
                        {formatMoney(line.balance)}
                      </td>
                      <td className="px-4 py-3 pr-6 text-right">
                        {line.kind === 'repayment' && line.reversible && canReverse ? (
                          <ReasonAction
                            trigger={
                              <Button variant="ghost" size="sm">
                                <Undo2 />
                                Reverse
                              </Button>
                            }
                            title="Reverse this reimbursement?"
                            description={`The reimbursement of ${formatMoney(line.amount.replace('-', ''))} stays on record; a reversal cancels it and the amount is owed to ${person.name} again.`}
                            confirmLabel="Reverse reimbursement"
                            placeholder="e.g. Paid from the wrong account"
                            successMessage="Reimbursement reversed"
                            onConfirm={({ reason, requestKey }) =>
                              reverseOwnerReimbursementAction({ id: line.id, reason, requestKey })
                            }
                          />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Panel>
      ))}
    </div>
  );
}

function ReimburseButton({
  personId,
  name,
  owed,
  modes,
  today,
}: {
  personId: string;
  name: string;
  owed: string;
  modes: PaymentModeOption[];
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, onSubmit, isPending] = useFormAction<ActionResult<{ id: string }>>(
    async (prev, formData) => {
      const result = await reimburseOwnerAction(personId, prev, formData);
      if (result.ok && result.data?.id) {
        const file = fileRef.current?.files?.[0];
        if (file) {
          const problem = await attachScannedBill(
            `${FILES_PATH}/${result.data.id}/bill`,
            file,
            'Transfer screenshot',
          );
          if (problem)
            toast.warning(`Reimbursement recorded, but the file wasn’t attached: ${problem}`);
        }
        toast.success(`Reimbursement to ${name} recorded`);
        setOpen(false);
        router.refresh();
      }
      return result;
    },
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};
  const startMode =
    modes.find((mode) => mode.method === 'BANK_TRANSFER') ??
    modes.find((mode) => mode.isDefault) ??
    modes[0];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm">
            <Banknote />
            Reimburse
          </Button>
        }
      />
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Reimburse {name}</DialogTitle>
          <DialogDescription>
            The workshop owes {name} {formatMoney(owed)} for bills paid personally. Record what was
            paid back — up to that amount.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <TextField
            label="Amount"
            name="amount"
            numeric="money"
            required
            defaultValue={owed}
            error={errors.amount}
            hint={`Up to ${formatMoney(owed)}.`}
            className="[&_input]:h-11 [&_input]:text-right [&_input]:tabular-nums"
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <PaymentModeField
              id={`reimburse-mode-${personId}`}
              modes={modes}
              label="Paid from"
              defaultModeId={startMode?.id}
              error={errors.method ?? errors.accountId}
              className="h-11 text-base md:text-sm"
            />
            <TextField
              label="Date"
              name="paidOn"
              type="date"
              required
              max={today}
              defaultValue={today}
              error={errors.paidOn}
              className="[&_input]:h-11"
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <ReferenceField
              label="Reference"
              name="reference"
              error={errors.reference}
              placeholder="Transfer or cheque reference"
              className="[&_input]:h-11"
            />
            <TextField label="Note" name="note" error={errors.note} className="[&_input]:h-11" />
          </div>
          <Field
            label="Transfer screenshot"
            htmlFor={`reimburse-file-${personId}`}
            hint="Optional. A photo or PDF, up to 10 MB."
          >
            <input
              ref={fileRef}
              id={`reimburse-file-${personId}`}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="text-sm"
            />
          </Field>
          <FormError message={Object.keys(errors).length ? undefined : state.error} />
          <SubmitButton pending={isPending} pendingLabel="Recording…" className="h-11">
            <Banknote />
            Record reimbursement
          </SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
