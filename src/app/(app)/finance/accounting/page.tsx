import Link from 'next/link';
import {
  BookOpen,
  BookText,
  Info,
  Landmark,
  NotebookPen,
  Plus,
  Scale,
  Sheet,
  TrendingUp,
  WalletCards,
} from 'lucide-react';
import { hasPermission, requireUser } from '@/lib/auth/authorize';
import {
  getCashSummary,
  listAccounts,
  type AccountGroups,
  type CashSummary,
} from '@/lib/finance/accounting';
import {
  getAccountChoices,
  getAccountLedger,
  getBalanceSheet,
  getLedgerProfitAndLoss,
  getTrialBalance,
  listJournal,
} from '@/lib/accounting/reports';
import { countUnbooked } from '@/lib/accounting/entries';
import { booksClosedThrough } from '@/lib/accounting/periods';
import { prisma } from '@/lib/prisma';
import { formatCalendarDate, formatDate, formatMoney, localDateString } from '@/lib/format';
import { LinkButton } from '@/components/shared/link-button';
import {
  AccountLedgerView,
  BalanceSheetView,
  JournalView,
  LedgerProfitView,
  TrialBalanceView,
} from '@/components/accounting/ledger-views';
import {
  AccountPicker,
  AddStandardAccountsButton,
  BookExistingButton,
  CloseBooksPanel,
} from '@/components/accounting/books-controls';
import { PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { InlineForm } from '@/components/shared/inline-form';
import { StatusPill } from '@/components/shared/status-pill';
import { FinancePeriodPicker } from '@/components/finance/period-picker';
import { EditAccountButton, NewAccountForm } from '@/components/finance/account-form';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type View = 'profit' | 'balance' | 'trial' | 'ledger' | 'journal' | 'cash' | 'accounts';

const TABS: { key: View; label: string; icon: typeof Scale }[] = [
  { key: 'profit', label: 'Profit & loss', icon: TrendingUp },
  { key: 'balance', label: 'Balance sheet', icon: Scale },
  { key: 'trial', label: 'Trial balance', icon: Sheet },
  { key: 'ledger', label: 'Ledger', icon: BookText },
  { key: 'journal', label: 'Journal', icon: NotebookPen },
  { key: 'cash', label: 'Cash in & out', icon: WalletCards },
  { key: 'accounts', label: 'Chart of accounts', icon: BookOpen },
];

const VIEWS = TABS.map((tab) => tab.key);
/** Views that cover a period; the others show a position on one date. */
const PERIOD_VIEWS: View[] = ['profit', 'ledger', 'journal', 'cash'];

/** Picks the date a balance is shown on — a plain GET form, no script needed. */
function AsOfPicker({ view, asOf }: { view: View; asOf: string }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="view" value={view} />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">As on</span>
        <input
          type="date"
          name="asOf"
          defaultValue={asOf}
          max={localDateString()}
          className="h-10 rounded-lg border border-input bg-card px-3"
        />
      </label>
      <button
        type="submit"
        className="h-10 rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted"
      >
        Show
      </button>
    </form>
  );
}

const PRESETS = ['month', 'last-month', 'quarter', 'last-quarter', 'year'] as const;

function Tabs({ active, search }: { active: View; search: string }) {
  return (
    <nav
      className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1"
      aria-label="Accounting"
    >
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const current = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={`/finance/accounting?view=${tab.key}${search}`}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'flex h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-colors',
              current
                ? 'bg-foreground text-background'
                : 'text-foreground/70 hover:bg-muted active:bg-muted',
            )}
          >
            <Icon className="size-4" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** One line of a statement: label, optional detail, amount. */
function Line({
  label,
  detail,
  amount,
  tone = 'default',
  indent,
}: {
  label: string;
  detail?: string;
  amount: string;
  tone?: 'default' | 'subtotal' | 'total' | 'negative';
  indent?: boolean;
}) {
  const negative = tone === 'negative';
  return (
    <li
      className={cn(
        'flex items-baseline justify-between gap-4 px-4 py-3 sm:px-6',
        tone === 'subtotal' && 'bg-muted/40 font-medium',
        tone === 'total' && 'bg-muted/60 text-base font-semibold',
      )}
    >
      <span className={cn('flex min-w-0 flex-col gap-0.5', indent && 'pl-4')}>
        <span className={cn('text-sm', tone === 'total' && 'text-base')}>{label}</span>
        {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
      </span>
      <span
        className={cn(
          'shrink-0 tabular-nums',
          negative && 'text-muted-foreground',
          tone === 'total' && amount.startsWith('-') && 'text-danger',
        )}
      >
        {negative ? `(${formatMoney(amount)})` : formatMoney(amount)}
      </span>
    </li>
  );
}

function CashView({ data }: { data: CashSummary }) {
  return (
    <Stack gap="xl">
      <Panel className="grid gap-6 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Money in</span>
          <span className="text-2xl leading-none font-semibold tabular-nums">
            {formatMoney(data.in.total)}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Money out</span>
          <span className="text-2xl leading-none font-semibold tabular-nums">
            {formatMoney(data.out.total)}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Net movement</span>
          <span
            className={cn(
              'text-2xl leading-none font-semibold tabular-nums',
              data.netFils < 0 ? 'text-danger' : 'text-success',
            )}
          >
            {formatMoney(data.net)}
          </span>
        </div>
      </Panel>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section
          title="In"
          description="Customer payments received. Reversed payments never count."
        >
          <Panel padding="none" className="overflow-hidden">
            <ul className="divide-y divide-border">
              {data.in.rows.length === 0 ? (
                <li className="px-4 py-4 text-sm text-muted-foreground sm:px-6">
                  Nothing received in this period.
                </li>
              ) : (
                data.in.rows.map((row) => (
                  <Line key={row.label} label={row.label} amount={row.amount} />
                ))
              )}
              <Line label="Total in" amount={data.in.total} tone="subtotal" />
            </ul>
          </Panel>
        </Section>
        <Section title="Out" description="Paid to suppliers, for expenses, and in salaries.">
          <Panel padding="none" className="overflow-hidden">
            <ul className="divide-y divide-border">
              {data.out.rows.map((row) => (
                <Line key={row.label} label={row.label} detail={row.detail} amount={row.amount} />
              ))}
              <Line label="Total out" amount={data.out.total} tone="subtotal" />
            </ul>
          </Panel>
        </Section>
      </div>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        Expenses not yet settled are left out until they are marked as paid. Expenses count on the
        date recorded against them.
      </p>
    </Stack>
  );
}

function AccountsView({ groups, canEdit }: { groups: AccountGroups; canEdit: boolean }) {
  return (
    <Stack gap="xl">
      {canEdit ? (
        <Panel padding="none" className="overflow-hidden">
          <InlineForm
            label="Add an account"
            hint="A new expense category, or an income, asset, liability or equity account."
            icon={<Landmark className="size-4" />}
          >
            <NewAccountForm />
          </InlineForm>
        </Panel>
      ) : null}
      {canEdit ? <AddStandardAccountsButton /> : null}
      {groups.map((group) => (
        <Section key={group.type} title={group.label}>
          {group.accounts.length === 0 ? (
            <Panel>
              <p className="text-sm text-muted-foreground">
                No {group.label.toLowerCase()} accounts.
              </p>
            </Panel>
          ) : (
            <Panel padding="none" className="overflow-hidden">
              <ul className="divide-y divide-border">
                {group.accounts.map((account) => (
                  <li
                    key={account.id}
                    className={cn(
                      'flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:px-6',
                      !account.isActive && 'text-muted-foreground',
                    )}
                  >
                    <span className="w-16 shrink-0 font-mono text-xs">{account.accountCode}</span>
                    <span className="min-w-0 flex-1 text-sm">{account.accountName}</span>
                    {account.role ? <StatusPill tone="info">System</StatusPill> : null}
                    {account.isPaymentAccount ? (
                      <StatusPill tone="success">Money account</StatusPill>
                    ) : null}
                    {account.isActive ? null : <StatusPill tone="neutral">Retired</StatusPill>}
                    {account._count.journalEntryLines ? (
                      <Link
                        href={`/finance/accounting?view=ledger&account=${account.id}`}
                        className="text-xs text-primary tabular-nums hover:underline"
                      >
                        Ledger
                      </Link>
                    ) : null}
                    {account._count.expenses ? (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {account._count.expenses} expense{account._count.expenses === 1 ? '' : 's'}
                      </span>
                    ) : null}
                    {canEdit ? (
                      <EditAccountButton
                        account={{
                          id: account.id,
                          accountCode: account.accountCode,
                          accountName: account.accountName,
                          accountType: account.accountType,
                          isActive: account.isActive,
                          isPaymentAccount: account.isPaymentAccount,
                          system: account.role !== null,
                        }}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </Section>
      ))}
    </Stack>
  );
}

export default async function AccountingPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    period?: string;
    from?: string;
    to?: string;
    asOf?: string;
    account?: string;
    source?: string;
  }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, 'accounting.view')) return <AccessDenied what="the accounts" />;
  const canEdit = hasPermission(user, 'accounting.edit');
  const params = await searchParams;
  const view: View = VIEWS.find((key) => key === params.view) ?? 'profit';
  const periodInput = { period: params.period, from: params.from, to: params.to };
  // Switching tab keeps the period chosen.
  const search = new URLSearchParams(
    Object.entries(periodInput).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ).toString();
  const tail = search ? `&${search}` : '';

  const [unbooked, closedThrough] = await Promise.all([
    countUnbooked(user),
    booksClosedThrough(prisma, user.organizationId),
  ]);
  const choices = view === 'ledger' ? await getAccountChoices(user) : null;
  const accountId = view === 'ledger' ? (params.account ?? choices?.all[0]?.id ?? null) : null;

  const profit = view === 'profit' ? await getLedgerProfitAndLoss(user, periodInput) : null;
  const balance = view === 'balance' ? await getBalanceSheet(user, { asOf: params.asOf }) : null;
  const trial = view === 'trial' ? await getTrialBalance(user, { asOf: params.asOf }) : null;
  const ledger = accountId ? await getAccountLedger(user, accountId, periodInput) : null;
  const journal =
    view === 'journal' ? await listJournal(user, { ...periodInput, source: params.source }) : null;
  const cash = view === 'cash' ? await getCashSummary(user, periodInput) : null;
  const accounts = view === 'accounts' ? await listAccounts(user) : null;
  const period = profit?.period ?? ledger?.period ?? journal?.period ?? cash?.period ?? null;
  const asOf = balance?.asOf ?? trial?.asOf ?? null;
  const intro =
    'Double-entry books kept automatically from invoices, payments, expenses, stock and payroll.';

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow="Finance"
        title="Accounting"
        description={
          period
            ? `From ${formatDate(period.from)} to ${formatDate(period.to)}. ${intro}`
            : asOf
              ? `On ${formatDate(asOf)}. ${intro}`
              : 'The accounts every amount is booked to.'
        }
        actions={
          canEdit ? (
            <LinkButton href="/finance/accounting/journal/new" size="lg">
              <Plus />
              Journal entry
            </LinkButton>
          ) : undefined
        }
      />

      {unbooked > 0 ? (
        <Panel className="flex flex-wrap items-center justify-between gap-4 border-warning/40 bg-warning/5">
          <p className="flex items-start gap-2 text-sm">
            <Info className="mt-0.5 size-4 shrink-0" />
            <span>
              <strong>
                {unbooked} record{unbooked === 1 ? ' is' : 's are'} not in the books yet
              </strong>{' '}
              — kept before the books existed. Book them once so every statement is complete. The
              records themselves don&apos;t change.
            </span>
          </p>
          {canEdit ? <BookExistingButton count={unbooked} /> : null}
        </Panel>
      ) : null}

      <Tabs active={view} search={tail} />

      {PERIOD_VIEWS.includes(view) && period ? (
        <FinancePeriodPicker
          period={period}
          basePath="/finance/accounting"
          presets={[...PRESETS]}
        />
      ) : null}
      {asOf ? <AsOfPicker view={view} asOf={asOf} /> : null}

      {profit ? <LedgerProfitView data={profit} search={tail} /> : null}
      {balance ? <BalanceSheetView data={balance} search={tail} /> : null}
      {trial ? <TrialBalanceView data={trial} search={tail} /> : null}
      {view === 'ledger' && choices ? (
        <Stack gap="xl">
          <AccountPicker accounts={choices.all} value={accountId} />
          {ledger ? <AccountLedgerView data={ledger} /> : null}
        </Stack>
      ) : null}
      {journal ? (
        <Stack gap="xl">
          <JournalView data={journal} canEdit={canEdit} />
          <Section
            title="Closing the books"
            description={
              closedThrough
                ? `Closed through ${formatCalendarDate(closedThrough)}.`
                : 'Every period is open.'
            }
          >
            <Panel>
              {canEdit ? (
                <CloseBooksPanel
                  closedThrough={closedThrough ? closedThrough.toISOString().slice(0, 10) : null}
                  today={localDateString()}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Only someone who manages the accounts can close or reopen a period.
                </p>
              )}
            </Panel>
          </Section>
        </Stack>
      ) : null}
      {cash ? <CashView data={cash} /> : null}
      {accounts ? <AccountsView groups={accounts} canEdit={canEdit} /> : null}
    </Stack>
  );
}
