import Link from 'next/link';
import { CalendarCheck2, Info } from 'lucide-react';
import { hasPermission, requireUser } from '@/lib/auth/authorize';
import { getYearEnd } from '@/lib/accounting/year-end';
import { formatCalendarDate, formatDateTime, formatMoney, localDateString } from '@/lib/format';
import { PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { EmptyState } from '@/components/shared/empty-state';
import { CloseYearButton, ReopenYearButton } from '@/components/accounting/year-end-forms';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function Amount({ value }: { value: string }) {
  return value.startsWith('-') ? (
    <span className="text-danger">({formatMoney(value.slice(1))})</span>
  ) : (
    <>{formatMoney(value)}</>
  );
}

export default async function YearEndPage({
  searchParams,
}: {
  searchParams: Promise<{ yearEnd?: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, 'accounting.view')) return <AccessDenied what="the accounts" />;
  const params = await searchParams;
  const data = await getYearEnd(user, { yearEnd: params.yearEnd });
  const canEdit = hasPermission(user, 'accounting.edit');
  const { preview } = data;
  const ended = data.yearEnd < localDateString();

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link href="/finance/accounting?view=accounts" className="hover:text-foreground">
            Accounting
          </Link>
        }
        title="Year-end closing"
        description="Closes a financial year: income and expense accounts go to zero and the year's result moves to retained earnings, ready for the next year."
      />

      <Section title="Close a year" description="Choose the last day of the financial year.">
        <Panel className="flex flex-col gap-6">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Year end</span>
              <input
                type="date"
                name="yearEnd"
                defaultValue={data.yearEnd}
                max={localDateString()}
                className="h-11 rounded-lg border border-input bg-card px-3"
              />
            </label>
            <button
              type="submit"
              className="h-11 rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted"
            >
              Show
            </button>
          </form>

          {data.alreadyClosed ? (
            <p className="text-sm text-muted-foreground">
              This year is already closed. Its closing entry is listed below.
            </p>
          ) : preview.income.length + preview.expenses.length === 0 ? (
            <EmptyState
              icon={CalendarCheck2}
              variant="inline"
              title="Nothing to close"
              description="No income or expense is booked up to that date."
            />
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[480px] text-sm">
                  <thead className="bg-muted/40 text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                    <tr>
                      <th className="w-20 px-4 py-3">Code</th>
                      <th className="px-2 py-3">Account</th>
                      <th className="w-40 px-4 py-3 text-right">Balance closed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    <tr className="bg-muted/20">
                      <td colSpan={3} className="px-4 py-2 text-xs font-semibold">
                        Income
                      </td>
                    </tr>
                    {preview.income.map((row) => (
                      <tr key={row.id}>
                        <td className="px-4 py-2 font-mono text-xs">{row.code}</td>
                        <td className="px-2 py-2">{row.name}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          <Amount value={row.amount} />
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-muted/20">
                      <td colSpan={3} className="px-4 py-2 text-xs font-semibold">
                        Expenses
                      </td>
                    </tr>
                    {preview.expenses.map((row) => (
                      <tr key={row.id}>
                        <td className="px-4 py-2 font-mono text-xs">{row.code}</td>
                        <td className="px-2 py-2">{row.name}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          <Amount value={row.amount} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-border bg-muted/40 font-semibold">
                    <tr>
                      <td colSpan={2} className="px-4 py-3">
                        {preview.profitFils < 0 ? 'Loss' : 'Profit'} to retained earnings
                      </td>
                      <td
                        className={cn(
                          'px-4 py-3 text-right tabular-nums',
                          preview.profitFils < 0 && 'text-danger',
                        )}
                      >
                        <Amount value={preview.profit} />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {canEdit && ended ? (
                <div>
                  <CloseYearButton yearEnd={data.yearEnd} profit={preview.profit} />
                </div>
              ) : !ended ? (
                <p className="text-sm text-muted-foreground">
                  This year has not ended yet — it can be closed from the day after{' '}
                  {formatCalendarDate(data.yearEnd)}.
                </p>
              ) : null}
            </>
          )}
        </Panel>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Before closing: book depreciation for the last month, record accruals and prepayments,
          reconcile the bank, and check the trial balance. After closing, the year&apos;s profit and
          loss still shows what it earned; the balance sheet carries it in retained earnings.
        </p>
      </Section>

      <Section title="Closed years">
        {data.closings.length === 0 ? (
          <Panel>
            <p className="text-sm text-muted-foreground">No year has been closed yet.</p>
          </Panel>
        ) : (
          <Panel padding="none" className="overflow-hidden">
            <ul className="divide-y divide-border">
              {data.closings.map((closing) => (
                <li
                  key={closing.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:px-6"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-medium">
                      Year ended {formatCalendarDate(closing.yearEnd)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      <span className="font-mono">{closing.entryNumber}</span> · closed by{' '}
                      {closing.closedBy} on {formatDateTime(closing.closedAt)}
                    </span>
                  </span>
                  <span className="text-sm tabular-nums">
                    {closing.profitFils < 0 ? 'Loss ' : 'Profit '}
                    <Amount value={closing.profit} />
                  </span>
                  {canEdit && closing.canReopen ? (
                    <ReopenYearButton entryId={closing.id} yearEnd={closing.yearEnd} />
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </Section>
    </Stack>
  );
}
