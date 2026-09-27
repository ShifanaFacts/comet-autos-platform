import Link from 'next/link';
import { BookOpen, Info, Landmark, Scale, WalletCards } from 'lucide-react';
import { hasPermission, requireUser } from '@/lib/auth/authorize';
import {
  getCashSummary,
  getProfitAndLoss,
  listAccounts,
  type AccountGroups,
  type CashSummary,
  type ProfitAndLoss,
} from '@/lib/finance/accounting';
import { formatDate, formatMoney } from '@/lib/format';
import { PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { InlineForm } from '@/components/shared/inline-form';
import { StatusPill } from '@/components/shared/status-pill';
import { FinancePeriodPicker } from '@/components/finance/period-picker';
import { EditAccountButton, NewAccountForm } from '@/components/finance/account-form';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type View = 'profit' | 'cash' | 'accounts';

const TABS: { key: View; label: string; icon: typeof Scale }[] = [
  { key: 'profit', label: 'Profit & loss', icon: Scale },
  { key: 'cash', label: 'Cash in & out', icon: WalletCards },
  { key: 'accounts', label: 'Chart of accounts', icon: BookOpen },
];

const PRESETS = ['month', 'last-month', 'quarter', 'last-quarter', 'year'] as const;

function Tabs({ active, search }: { active: View; search: string }) {
  return (
    <nav
      className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1"
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
              'flex h-11 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-colors',
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

function ProfitView({ data }: { data: ProfitAndLoss }) {
  return (
    <Stack gap="xl">
      <Panel className="grid gap-6 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Sales</span>
          <span className="text-2xl leading-none font-semibold tabular-nums">
            {formatMoney(data.sales.total)}
          </span>
          <span className="text-xs text-muted-foreground">
            {data.sales.invoices} tax invoice{data.sales.invoices === 1 ? '' : 's'} · excl. VAT
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Gross profit</span>
          <span className="text-2xl leading-none font-semibold tabular-nums">
            {formatMoney(data.grossProfit)}
          </span>
          <span className="text-xs text-muted-foreground">
            {data.grossMargin === null ? 'No sales yet' : `${data.grossMargin}% margin`}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Net profit</span>
          <span
            className={cn(
              'text-2xl leading-none font-semibold tabular-nums',
              data.netProfitFils < 0 ? 'text-danger' : 'text-success',
            )}
          >
            {formatMoney(data.netProfit)}
          </span>
          <span className="text-xs text-muted-foreground">
            {data.netProfitFils < 0 ? 'A loss for the period' : 'After expenses and salaries'}
          </span>
        </div>
      </Panel>

      <Section title="Statement" description="Accrual basis: counted when billed, not when paid.">
        <Panel padding="none" className="overflow-hidden">
          <ul className="divide-y divide-border">
            <Line label="Parts sold" amount={data.sales.parts} indent />
            <Line label="Labour" amount={data.sales.labour} indent />
            {data.sales.other !== '0.00' ? (
              <Line label="Other charges" amount={data.sales.other} indent />
            ) : null}
            <Line label="Sales" amount={data.sales.total} tone="subtotal" />
            <Line
              label="Cost of parts fitted"
              detail="What the parts on these invoiced jobs cost, after any taken back"
              amount={data.partsCost}
              tone="negative"
              indent
            />
            <Line label="Gross profit" amount={data.grossProfit} tone="subtotal" />
            {data.expenses.rows.map((row) => (
              <Line
                key={row.id ?? 'none'}
                label={row.name}
                detail={`${row.code ? `${row.code} · ` : ''}${row.count} expense${row.count === 1 ? '' : 's'}`}
                amount={row.amount}
                tone="negative"
                indent
              />
            ))}
            {data.payroll.runs > 0 ? (
              <Line
                label="Salaries (payroll)"
                detail={`${data.payroll.runs} approved run${data.payroll.runs === 1 ? '' : 's'}`}
                amount={data.payroll.total}
                tone="negative"
                indent
              />
            ) : null}
            <Line label="Total operating costs" amount={data.operatingCosts} tone="subtotal" />
            <Line label="Net profit" amount={data.netProfit} tone="total" />
          </ul>
        </Panel>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Built from invoices, parts fitted, expenses and payroll — nothing is keyed in twice. If
          salaries are also entered as expenses they will show up in both places; record pay through
          Payroll only.
        </p>
      </Section>
    </Stack>
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
                    {account.isActive ? null : <StatusPill tone="neutral">Retired</StatusPill>}
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
                          isActive: account.isActive,
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
  searchParams: Promise<{ view?: string; period?: string; from?: string; to?: string }>;
}) {
  const user = await requireUser();
  if (!hasPermission(user, 'accounting.view')) return <AccessDenied what="the accounts" />;
  const params = await searchParams;
  const view: View = params.view === 'cash' || params.view === 'accounts' ? params.view : 'profit';
  const periodInput = { period: params.period, from: params.from, to: params.to };
  // Switching tab keeps the period chosen.
  const search = new URLSearchParams(
    Object.entries(periodInput).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ).toString();

  const profit = view === 'profit' ? await getProfitAndLoss(user, periodInput) : null;
  const cash = view === 'cash' ? await getCashSummary(user, periodInput) : null;
  const accounts = view === 'accounts' ? await listAccounts(user) : null;
  const period = profit?.period ?? cash?.period ?? null;

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow="Finance"
        title="Accounting"
        description={
          period
            ? `From ${formatDate(period.from)} to ${formatDate(period.to)}, read straight from invoices, payments, expenses and payroll.`
            : 'The accounts expenses and income are filed under.'
        }
      />

      <Tabs active={view} search={search ? `&${search}` : ''} />

      {period ? (
        <FinancePeriodPicker
          period={period}
          basePath="/finance/accounting"
          presets={[...PRESETS]}
        />
      ) : null}

      {profit ? <ProfitView data={profit} /> : null}
      {cash ? <CashView data={cash} /> : null}
      {accounts ? (
        <AccountsView groups={accounts} canEdit={hasPermission(user, 'accounting.edit')} />
      ) : null}
    </Stack>
  );
}
