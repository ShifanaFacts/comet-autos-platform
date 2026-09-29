import Link from 'next/link';
import { AlertTriangle, Info, Users } from 'lucide-react';
import { hasPermission, requireUser } from '@/lib/auth/authorize';
import { getOpeningBalances } from '@/lib/accounting/opening-balances';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { EmptyState } from '@/components/shared/empty-state';
import { InlineForm } from '@/components/shared/inline-form';
import { StatusPill } from '@/components/shared/status-pill';
import {
  CustomerOpeningForm,
  OpeningBalancesForm,
  RemoveCustomerOpeningButton,
} from '@/components/accounting/opening-balance-forms';

export const dynamic = 'force-dynamic';

export default async function OpeningBalancesPage() {
  const user = await requireUser();
  if (!hasPermission(user, 'accounting.view')) return <AccessDenied what="the accounts" />;
  const data = await getOpeningBalances(user);
  const canEdit = hasPermission(user, 'accounting.edit');

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link href="/finance/accounting?view=accounts" className="hover:text-foreground">
            Accounting
          </Link>
        }
        title="Opening balances"
        description="What the business had and owed on the day these books begin. Entered once, on one date; the difference goes to Opening balance equity, to be cleared to capital or retained earnings."
      />

      {data.closedThrough && data.date && data.date <= data.closedThrough ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          The books are closed through {formatCalendarDate(data.closedThrough)}, which includes the
          opening date. Reopen the period to change opening balances.
        </p>
      ) : null}
      {data.earlierActivity ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          Transactions are booked on or before the opening date (the first on{' '}
          {formatCalendarDate(data.earlierActivity)}). Their effect is already in the balances —
          check nothing is counted twice, or move the opening date earlier.
        </p>
      ) : null}

      <Section
        title="Account balances"
        description={
          data.entryNumber
            ? `Booked as journal entry ${data.entryNumber}. Saving again reverses it and books the new figures.`
            : 'Cash, bank, prepayments, deposits, loans, capital — every balance-sheet account the business already had.'
        }
      >
        <Panel>
          {canEdit ? (
            <OpeningBalancesForm
              rows={data.rows}
              date={data.date}
              suggestedDate={data.suggestedDate}
              locked={data.customers.length > 0}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {data.date
                ? `Opening balances are dated ${formatCalendarDate(data.date)}.`
                : 'No opening balances have been entered yet.'}{' '}
              Your role can view but not change them.
            </p>
          )}
        </Panel>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Trade receivables come from each customer&apos;s balance below, inventory from each
          part&apos;s opening stock, and fixed assets from the register — entering them here as well
          would count them twice.
        </p>
      </Section>

      <Section
        title="Customer opening balances"
        description={`What each customer owed on the opening date — ${formatMoney(data.customerTotal)} in total. Receipts are recorded against them like any invoice, and they age and appear on statements.`}
      >
        {data.customers.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No customer opening balances"
            description="Add each customer who owed money when the books began."
          />
        ) : (
          <Panel padding="none" className="overflow-hidden">
            <ul className="divide-y divide-border">
              {data.customers.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:px-6"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-medium">{row.customer.name}</span>
                    <span className="text-xs text-muted-foreground">
                      <Link
                        href={`/finance/invoices/${row.id}`}
                        className="font-mono hover:underline"
                      >
                        {row.number}
                      </Link>
                      {row.reference ? ` · ${row.reference}` : ''}
                      {row.dueDate ? ` · due ${formatCalendarDate(row.dueDate)}` : ''}
                    </span>
                  </span>
                  {row.status === 'PAID' ? (
                    <StatusPill tone="success">Received</StatusPill>
                  ) : row.received !== '0.00' ? (
                    <StatusPill tone="info">{formatMoney(row.received)} received</StatusPill>
                  ) : null}
                  <span className="text-sm font-semibold tabular-nums">
                    {formatMoney(row.amount)}
                  </span>
                  {canEdit && row.received === '0.00' ? (
                    <RemoveCustomerOpeningButton invoiceId={row.id} label={row.number} />
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>
        )}
        {canEdit ? (
          <Panel padding="none" className="overflow-hidden">
            {data.date ? (
              <InlineForm
                label="Add a customer’s opening balance"
                hint={`Dated ${formatCalendarDate(data.date)}.`}
                defaultOpen={data.customers.length === 0}
              >
                <CustomerOpeningForm openingDate={data.date} />
              </InlineForm>
            ) : (
              <p className="px-4 py-4 text-sm text-muted-foreground sm:px-6">
                Save the opening date with the account balances above first.
              </p>
            )}
          </Panel>
        ) : null}
      </Section>
    </Stack>
  );
}
