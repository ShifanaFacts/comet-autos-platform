'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCheck, Landmark, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FormError, NativeSelect, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import type { ActionResult } from '@/lib/errors';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { filsToString, toFils } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { ReconciliationDetail } from '@/lib/accounting/reconciliation';
import {
  completeReconciliationAction,
  discardReconciliationAction,
  reopenReconciliationAction,
  setReconciledLinesAction,
  startReconciliationAction,
} from '@/app/(app)/finance/bank-reconciliation/actions';

/** Starting a reconciliation: which account, and the statement's date and closing balance. */
export function StartReconciliationForm({
  accounts,
  today,
}: {
  accounts: { id: string; label: string }[];
  today: string;
}) {
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    (prev, formData) => startReconciliationAction(prev, formData),
    { ok: false },
  );
  const errors = state.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="grid gap-6 md:grid-cols-3">
        <Field label="Account" htmlFor="rec-account" required error={errors.accountId}>
          <NativeSelect id="rec-account" name="accountId" required className="h-11">
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Statement date" htmlFor="rec-date" required error={errors.statementDate}>
          <Input
            id="rec-date"
            name="statementDate"
            type="date"
            required
            max={today}
            defaultValue={today}
            className="h-11"
          />
        </Field>
        <TextField
          label="Closing balance on the statement (AED)"
          name="statementBalance"
          required
          inputMode="decimal"
          error={errors.statementBalance}
          hint="Negative if overdrawn, e.g. -250.00."
          className="[&_input]:h-11 [&_input]:text-right [&_input]:tabular-nums"
        />
      </div>
      <FormError message={Object.keys(errors).length ? undefined : state.error} />
      <div>
        <SubmitButton pending={isPending} className="h-11" pendingLabel="Starting…">
          <Landmark />
          Start reconciling
        </SubmitButton>
      </div>
    </form>
  );
}

const signedFils = (value: string) =>
  value.startsWith('-') ? -toFils(value.slice(1)) : toFils(value);
const signedMoney = (fils: number) =>
  fils < 0 ? `−${formatMoney(filsToString(-fils))}` : formatMoney(filsToString(fils));

/**
 * The lines to tick against the statement. Ticks are saved as they are made;
 * the figures above the table follow at once.
 */
export function ReconciliationSheet({ detail }: { detail: ReconciliationDetail }) {
  const router = useRouter();
  const editable = detail.status === 'IN_PROGRESS';
  const [ticked, setTicked] = useState(
    () => new Set(detail.rows.filter((row) => row.ticked).map((row) => row.id)),
  );
  const [showCleared, setShowCleared] = useState(true);
  const [isPending, startTransition] = useTransition();

  const amountOf = (row: ReconciliationDetail['rows'][number]) =>
    row.moneyIn ? toFils(row.moneyIn) : -toFils(row.moneyOut);
  const figures = useMemo(() => {
    let cleared = signedFils(detail.openingBalance);
    for (const row of detail.rows) if (ticked.has(row.id)) cleared += amountOf(row);
    return { cleared, difference: signedFils(detail.statementBalance) - cleared };
  }, [ticked, detail]);

  function save(lineIds: string[], tick: boolean) {
    const before = new Set(ticked);
    const next = new Set(ticked);
    for (const id of lineIds) {
      if (tick) next.add(id);
      else next.delete(id);
    }
    setTicked(next);
    startTransition(async () => {
      const result = await setReconciledLinesAction(detail.id, lineIds, tick);
      if (!result.ok) {
        setTicked(before);
        toast.error(result.error ?? 'Could not save the tick.');
      }
    });
  }

  function run(action: () => Promise<ActionResult>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(success);
        router.refresh();
      } else if (result.error) {
        toast.error(result.error);
      }
    });
  }

  const visible = detail.rows.filter((row) => showCleared || !ticked.has(row.id));
  const allTicked = detail.rows.length > 0 && detail.rows.every((row) => ticked.has(row.id));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label="Statement balance"
          value={signedMoney(signedFils(detail.statementBalance))}
        />
        <Figure
          label={
            detail.previousDate
              ? `Reconciled to ${formatCalendarDate(detail.previousDate)}`
              : 'Opening (first reconciliation)'
          }
          value={signedMoney(signedFils(detail.openingBalance))}
        />
        <Figure label="Cleared balance" value={signedMoney(figures.cleared)} />
        <Figure
          label="Difference"
          value={signedMoney(figures.difference)}
          tone={figures.difference === 0 ? 'good' : 'bad'}
        />
      </div>

      {editable ? (
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Button
            type="button"
            disabled={isPending || figures.difference !== 0}
            onClick={() =>
              run(() => completeReconciliationAction(detail.id), 'Reconciliation completed')
            }
            className="h-10"
          >
            <CheckCheck />
            Complete reconciliation
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() =>
              save(
                detail.rows.map((row) => row.id),
                !allTicked,
              )
            }
            className="h-10"
          >
            {allTicked ? 'Untick all' : 'Tick all'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowCleared((value) => !value)}
            className="h-10"
          >
            {showCleared ? 'Hide ticked lines' : 'Show ticked lines'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={isPending}
            onClick={() => run(() => discardReconciliationAction(detail.id), 'Discarded')}
            className="h-10 text-destructive"
          >
            <Trash2 />
            Discard
          </Button>
          {figures.difference !== 0 ? (
            <p className="w-full text-xs text-muted-foreground">
              Tick every line that appears on the bank statement. Bank charges or interest on the
              statement that are not in the books: record them first (an expense, or a journal
              entry), then tick them here.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => run(() => reopenReconciliationAction(detail.id), 'Reopened')}
            className="h-10"
          >
            <RotateCcw />
            Reopen
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="bg-muted/40 text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
            <tr>
              <th className="w-12 px-4 py-3">
                <span className="sr-only">On the statement</span>
              </th>
              <th className="w-28 px-2 py-3">Date</th>
              <th className="px-2 py-3">Entry</th>
              <th className="w-32 px-2 py-3 text-right">Money in</th>
              <th className="w-32 px-4 py-3 text-right">Money out</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  Nothing to show.
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={row.id} className={cn(ticked.has(row.id) && 'bg-success/5')}>
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={`On the statement: ${row.description}`}
                      checked={ticked.has(row.id)}
                      disabled={!editable}
                      onChange={(event) => save([row.id], event.target.checked)}
                      className="size-4"
                    />
                  </td>
                  <td className="px-2 py-2.5 tabular-nums whitespace-nowrap">
                    {formatCalendarDate(row.date)}
                  </td>
                  <td className="px-2 py-2.5">
                    <span className="font-mono text-xs text-muted-foreground">
                      {row.entryNumber ?? ''}
                    </span>{' '}
                    {row.description}
                    {row.reversed ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (reversed — tick with its reversal)
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    {row.moneyIn ? formatMoney(row.moneyIn) : ''}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {row.moneyOut ? formatMoney(row.moneyOut) : ''}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      <span
        className={cn(
          'text-xl font-semibold tabular-nums',
          tone === 'good' && 'text-success',
          tone === 'bad' && 'text-destructive',
        )}
      >
        {value}
      </span>
    </div>
  );
}
