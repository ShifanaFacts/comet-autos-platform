import Link from 'next/link';
import { Suspense } from 'react';
import {
  ArrowRight,
  CalendarPlus,
  ClipboardList,
  FileText,
  Receipt,
  type LucideIcon,
} from 'lucide-react';
import { hasPermission, requireUser } from '@/lib/auth/authorize';
import { formatMoney, WORKSHOP_LOCALE, WORKSHOP_TIME_ZONE } from '@/lib/format';
import { getGarageSummary, type GarageSummary } from '@/lib/overview/garage';
import { getWorkshopPreferences } from '@/lib/organization/settings';
import { isMenuShown } from '@/lib/nav';
import { Grid, Panel, Section, Stack } from '@/components/layout/primitives';
import { FinancePeriodPicker } from '@/components/finance/period-picker';
import { OwedToOwnerLine } from '@/components/finance/owed-to-owner-line';
import { MyDayStrip } from '@/components/team/my-day-strip';
import { RankedBars } from '@/components/reports/charts';
import { AttentionChip, Kpi, KpiRow } from '@/components/overview/kpi';
import { RevenueCostTrend } from '@/components/overview/trend-chart';
import { cn } from '@/lib/utils';

/*
 * The dashboard: the whole garage at a glance. What it earned and kept, the
 * money in and owed, and how the workshop is doing — each against the period
 * before — then twelve months of revenue against costs, and what needs
 * attention now. Starting a job card, quotation or invoice is a small row of
 * buttons at the top; the detail lives in each section's own overview.
 */

export const dynamic = 'force-dynamic';

function greeting(): string {
  const hour = Number(
    new Date().toLocaleString('en-GB', {
      timeZone: WORKSHOP_TIME_ZONE,
      hour: 'numeric',
      hour12: false,
    }),
  );
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const PRESETS = ['month', 'last-month', 'quarter', 'year'] as const;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const input = { period: params.period ?? 'month', from: params.from, to: params.to };
  const scope = user.primaryBranchId ? { branchId: user.primaryBranchId } : undefined;
  const preferences = await getWorkshopPreferences(user.organizationId);
  const menu = (href: string) => isMenuShown(href, preferences);
  const today = new Date().toLocaleDateString(WORKSHOP_LOCALE, {
    timeZone: WORKSHOP_TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const actions: { href: string; label: string; icon: LucideIcon; primary?: boolean }[] = [
    ...(hasPermission(user, 'job_card.create', scope)
      ? [{ href: '/check-in', label: 'New job card', icon: ClipboardList, primary: true }]
      : []),
    ...(hasPermission(user, 'quotation.create', scope) && menu('/quotations')
      ? [{ href: '/quotations/new', label: 'Quotation', icon: FileText }]
      : []),
    ...(hasPermission(user, 'invoice.create', scope) && menu('/finance/invoices')
      ? [{ href: '/finance/invoices/new', label: 'Invoice', icon: Receipt }]
      : []),
    ...(hasPermission(user, 'appointment.create', scope) && menu('/appointments')
      ? [{ href: '/appointments/new', label: 'Appointment', icon: CalendarPlus }]
      : []),
  ];

  const summary = await getGarageSummary(user, input);
  const anything =
    summary.profit || summary.money.invoiced !== null || summary.jobs || summary.money.inHand;

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      {/* Greeting, and the day's starting points kept small. */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">{today}</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {greeting()}, {user.fullName.split(' ')[0]}
          </h1>
          <p className="text-sm text-muted-foreground">
            How the garage is doing — {summary.period.label.toLowerCase()}.
          </p>
        </div>
        {actions.length ? (
          <nav aria-label="Start" className="flex flex-wrap gap-2">
            {actions.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.href}
                  href={action.href}
                  className={cn(
                    'inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-sm font-medium whitespace-nowrap transition-colors',
                    action.primary
                      ? 'border-primary bg-primary text-primary-foreground hover:bg-primary-hover'
                      : 'border-border bg-card hover:bg-muted',
                  )}
                >
                  <Icon className="size-4" />
                  {action.label}
                </Link>
              );
            })}
          </nav>
        ) : null}
      </header>

      <Suspense fallback={null}>
        <MyDayStrip user={user} />
      </Suspense>

      {anything ? (
        <FinancePeriodPicker period={summary.period} basePath="/" presets={[...PRESETS]} />
      ) : null}

      {hasPermission(user, 'accounting.view') ? (
        <Suspense fallback={null}>
          <OwedToOwnerLine organizationId={user.organizationId} />
        </Suspense>
      ) : null}

      <Earnings summary={summary} />
      <MoneyPosition summary={summary} />

      {summary.trend ? (
        <Section
          title="Revenue against costs — last 12 months"
          description="From the books: revenue excl. VAT, against cost of parts and every expense. The gap between the two is the profit."
          action={
            <SectionLink href="/finance/accounting?view=profit">Profit &amp; loss</SectionLink>
          }
        >
          <Panel>
            <RevenueCostTrend data={summary.trend} />
          </Panel>
        </Section>
      ) : null}

      <Attention summary={summary} menu={menu} />

      {summary.jobs || summary.sales ? (
        <Grid gap="xl" className="items-start lg:grid-cols-2">
          {summary.jobs ? <WorkshopSummary summary={summary} /> : null}
          {summary.sales ? <SalesSummary summary={summary} /> : null}
        </Grid>
      ) : null}

      {!anything ? (
        <Panel>
          <p className="text-sm text-muted-foreground">
            Your role has no figures to show here. Use the menu to open your work.
          </p>
        </Panel>
      ) : null}
    </Stack>
  );
}

function SectionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-hover"
    >
      {children}
      <ArrowRight className="size-4" />
    </Link>
  );
}

/** What the garage earned and kept, from the books — or, without reports, what it invoiced. */
function Earnings({ summary }: { summary: GarageSummary }) {
  const { profit, money, compareLabel } = summary;
  if (profit) {
    return (
      <KpiRow>
        <Kpi
          label="Revenue"
          value={formatMoney(profit.revenue)}
          change={profit.revenueGrowth}
          compareLabel={compareLabel}
          hint="Sales booked, excl. VAT"
          href="/finance/accounting?view=profit"
        />
        <Kpi
          label="Gross profit"
          value={formatMoney(profit.grossProfit)}
          change={profit.grossGrowth}
          compareLabel={compareLabel}
          hint={
            profit.grossMargin !== null
              ? `${profit.grossMargin}% of revenue, after the cost of parts`
              : 'Revenue less the cost of parts'
          }
        />
        <Kpi
          label="Costs and expenses"
          value={formatMoney(profit.costs)}
          change={profit.costsGrowth}
          compareLabel={compareLabel}
          lowerIsBetter
          hint="Cost of parts sold and every expense"
          href="/finance/expenses"
        />
        <Kpi
          label="Net profit"
          value={formatMoney(profit.netProfit)}
          change={profit.netGrowth}
          compareLabel={compareLabel}
          tone={profit.netFils < 0 ? 'bad' : profit.netFils > 0 ? 'good' : 'default'}
          hint={
            profit.netMargin !== null
              ? `${profit.netMargin}% of revenue kept`
              : 'What is left after everything'
          }
        />
      </KpiRow>
    );
  }
  if (money.invoiced === null) return null;
  return (
    <KpiRow>
      <Kpi
        label="Invoiced"
        value={formatMoney(money.invoiced)}
        change={money.invoicedGrowth}
        compareLabel={compareLabel}
        hint="Excl. VAT"
        href="/finance/invoices"
      />
      <Kpi
        label="Collected"
        value={formatMoney(money.collected ?? '0')}
        change={money.collectedGrowth}
        compareLabel={compareLabel}
        hint="Payments received, incl. VAT"
        href="/finance/payments"
      />
    </KpiRow>
  );
}

/** Money in, money owed both ways, money in hand. */
function MoneyPosition({ summary }: { summary: GarageSummary }) {
  const { money, compareLabel } = summary;
  const tiles = [
    money.collected !== null && summary.profit
      ? {
          key: 'collected',
          node: (
            <Kpi
              key="collected"
              label="Collected"
              value={formatMoney(money.collected)}
              change={money.collectedGrowth}
              compareLabel={compareLabel}
              hint="Payments received in the period, incl. VAT"
              href="/finance/payments"
            />
          ),
        }
      : null,
    money.receivables
      ? {
          key: 'owe',
          node: (
            <Kpi
              key="owe"
              label="Customers owe"
              value={formatMoney(money.receivables.balance)}
              hint={
                Number(money.receivables.overdue) > 0
                  ? `${formatMoney(money.receivables.overdue)} overdue on ${money.receivables.overdueCount} invoice${money.receivables.overdueCount === 1 ? '' : 's'}`
                  : `${money.receivables.count} unpaid invoice${money.receivables.count === 1 ? '' : 's'}, none overdue`
              }
              tone={Number(money.receivables.overdue) > 0 ? 'bad' : 'default'}
              href="/finance/outstanding"
            />
          ),
        }
      : null,
    money.payables
      ? {
          key: 'owed',
          node: (
            <Kpi
              key="owed"
              label="We owe suppliers"
              value={formatMoney(money.payables.balance)}
              hint={`${money.payables.parties} supplier${money.payables.parties === 1 ? '' : 's'} · ${money.payables.count} bill${money.payables.count === 1 ? '' : 's'}`}
              href="/finance/payables"
            />
          ),
        }
      : null,
    money.inHand !== null
      ? {
          key: 'cash',
          node: (
            <Kpi
              key="cash"
              label="Cash and bank now"
              value={formatMoney(money.inHand)}
              hint="Cash on hand, petty cash and bank"
              href="/finance/money"
            />
          ),
        }
      : null,
  ].filter((tile) => tile !== null);
  if (tiles.length === 0) return null;
  return <KpiRow>{tiles.map((tile) => tile.node)}</KpiRow>;
}

/** The few things worth acting on now, each a tap from its list. */
function Attention({ summary, menu }: { summary: GarageSummary; menu: (href: string) => boolean }) {
  const actions = summary.jobs?.actions;
  const receivables = summary.money.receivables;
  const chips = [
    receivables && receivables.overdueCount > 0
      ? {
          href: '/finance/outstanding',
          count: formatMoney(receivables.overdue),
          label: `overdue from customers`,
          tone: 'danger' as const,
        }
      : null,
    actions && actions.waitingApproval > 0
      ? {
          href: '/approvals',
          count: actions.waitingApproval,
          label: 'waiting for customer approval',
          tone: 'warning' as const,
        }
      : null,
    actions && actions.ready > 0
      ? { href: '/job-cards?status=READY', count: actions.ready, label: 'ready — not invoiced' }
      : null,
    actions && actions.awaitingPayment > 0
      ? {
          href: '/job-cards?status=INVOICED',
          count: actions.awaitingPayment,
          label: 'invoiced — awaiting payment',
        }
      : null,
    actions && actions.toDeliver > 0
      ? {
          href: '/job-cards?status=PAID',
          count: actions.toDeliver,
          label: 'paid — ready to hand over',
        }
      : null,
    summary.lowStock && menu('/inventory/parts')
      ? {
          href: '/inventory/parts?stock=low',
          count: summary.lowStock,
          label: `part${summary.lowStock === 1 ? '' : 's'} low on stock`,
          tone: 'warning' as const,
        }
      : null,
  ].filter((chip) => chip !== null);
  if (chips.length === 0) return null;
  return (
    <Section title="Needs attention" description="Open the list behind each to act on it.">
      <div className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <AttentionChip key={chip.href} {...chip} />
        ))}
      </div>
    </Section>
  );
}

function WorkshopSummary({ summary }: { summary: GarageSummary }) {
  const jobs = summary.jobs!;
  const figures = [
    { label: 'In the workshop now', value: String(jobs.openNow) },
    { label: 'Average days in', value: jobs.averageDays !== null ? `${jobs.averageDays}` : '—' },
    { label: 'Technician hours', value: jobs.totalHours || '0' },
    { label: 'Cancelled', value: String(jobs.cancelled) },
  ];
  return (
    <Section
      title="Workshop"
      description="Job cards opened and vehicles handed back in the period."
      action={<SectionLink href="/workshop">Workshop overview</SectionLink>}
    >
      <Panel padding="none" className="flex flex-col">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-t-xl bg-border">
          <div className="bg-card">
            <Kpi
              label="Job cards opened"
              value={String(jobs.opened)}
              change={jobs.openedGrowth}
              compareLabel={summary.compareLabel}
              href="/job-cards"
            />
          </div>
          <div className="bg-card">
            <Kpi
              label="Vehicles delivered"
              value={String(jobs.delivered)}
              change={jobs.deliveredGrowth}
              compareLabel={summary.compareLabel}
            />
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border px-4 py-4 sm:px-5">
          {figures.map((figure) => (
            <div key={figure.label} className="flex flex-col">
              <dt className="text-xs text-muted-foreground">{figure.label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{figure.value}</dd>
            </div>
          ))}
        </dl>
        {jobs.makes.length ? (
          <div className="border-t border-border pt-2">
            <p className="px-4 pt-2 text-xs font-medium text-muted-foreground sm:px-6">
              Vehicles by make
            </p>
            <RankedBars
              rows={jobs.makes.slice(0, 5).map((row) => ({
                key: row.make,
                label: row.make,
                value: `${row.count} job${row.count === 1 ? '' : 's'}`,
                weight: row.count,
              }))}
            />
          </div>
        ) : null}
      </Panel>
    </Section>
  );
}

function SalesSummary({ summary }: { summary: GarageSummary }) {
  const sales = summary.sales!;
  return (
    <Section
      title="Sales"
      description="Invoices issued in the period and the customers behind them."
      action={<SectionLink href="/sales">Sales overview</SectionLink>}
    >
      <Panel padding="none" className="flex flex-col">
        <dl className="grid grid-cols-3 gap-x-4 gap-y-3 px-4 py-4 sm:px-5">
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">Invoices</dt>
            <dd className="text-lg font-semibold tabular-nums">{sales.count}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">Average invoice</dt>
            <dd className="text-lg font-semibold tabular-nums">{formatMoney(sales.average)}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">Customers</dt>
            <dd className="text-lg font-semibold tabular-nums">{sales.customers}</dd>
          </div>
        </dl>
        {sales.topCustomers.length ? (
          <div className="border-t border-border pt-2">
            <p className="px-4 pt-2 text-xs font-medium text-muted-foreground sm:px-6">
              Top customers (excl. VAT)
            </p>
            <RankedBars
              rows={sales.topCustomers.slice(0, 5).map((row) => ({
                key: row.id,
                label: row.name,
                detail: `${row.count} invoice${row.count === 1 ? '' : 's'}`,
                value: formatMoney(row.value),
                weight: row.valueFils,
              }))}
            />
          </div>
        ) : (
          <p className="border-t border-border px-4 py-6 text-sm text-muted-foreground sm:px-6">
            No invoices in this period yet.
          </p>
        )}
      </Panel>
    </Section>
  );
}
