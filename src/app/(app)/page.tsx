import Link from 'next/link';
import { Suspense, cache } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  FileText,
  KeyRound,
  LogIn,
  PackageCheck,
  PauseCircle,
  Receipt,
  ShieldCheck,
  Wallet,
  Wrench,
} from 'lucide-react';
import { hasPermission, requireUser } from '@/lib/auth/authorize';
import type { AuthenticatedUser } from '@/lib/auth/session';
import {
  getFinanceSnapshot as fetchFinance,
  getLowStockParts as fetchLowStock,
  getRecentJobCards,
  getTodaysAppointments,
  getWorkshopFlow as fetchWorkshopFlow,
} from '@/lib/data/dashboard';
import { formatMoney, formatTime, WORKSHOP_TIME_ZONE } from '@/lib/format';
import { formatMilli } from '@/lib/money';
import { Grid, PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { EmptyState } from '@/components/shared/empty-state';
import { QuickAction } from '@/components/shared/quick-action';
import { WorkshopFlowRow } from '@/components/shared/workshop-flow-row';
import { JobStatusBadge } from '@/components/shared/job-status-badge';
import { VehiclePlate } from '@/components/shared/vehicle-plate';
import { StockPill } from '@/components/inventory/stock-level';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// Several independently-streamed sections read the same queries; cache()
// dedupes them to one database round-trip per request.
const getWorkshopFlow = cache(fetchWorkshopFlow);
const getLowStock = cache(fetchLowStock);

function dubaiHour() {
  return Number(
    new Date().toLocaleString('en-GB', {
      timeZone: WORKSHOP_TIME_ZONE,
      hour: 'numeric',
      hour12: false,
    }),
  );
}

function greeting(): string {
  const hour = dubaiHour();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default async function DashboardPage() {
  const user = await requireUser();
  const firstName = user.fullName.split(' ')[0];
  const today = new Date().toLocaleDateString('en-AE', {
    timeZone: WORKSHOP_TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const org = user.organizationId;
  const scope = user.primaryBranchId ? { branchId: user.primaryBranchId } : undefined;
  const canFinance = hasPermission(user, 'invoice.view', scope);
  const canInventory = hasPermission(user, 'inventory.view', scope);
  const canCheckIn = hasPermission(user, 'job_card.create', scope);

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={today}
        title={`${greeting()}, ${firstName}`}
        description="What needs attention in the workshop right now."
        actions={
          <>
            <QuickAction href="/job-cards" icon={ClipboardList} label="Job cards" />
            {canCheckIn ? (
              <QuickAction href="/appointments/new" icon={CalendarPlus} label="New appointment" />
            ) : null}
            {canCheckIn ? (
              <QuickAction href="/check-in" icon={LogIn} label="Check in vehicle" primary />
            ) : null}
          </>
        }
      />

      <Suspense fallback={<Skeleton className="h-28 rounded-2xl" />}>
        <RightNow organizationId={org} />
      </Suspense>

      <Section
        title="Action required"
        description="Jobs waiting for the next step — open one to act on it."
      >
        <Suspense fallback={<ActionsSkeleton />}>
          <ActionBoard organizationId={org} />
        </Suspense>
      </Section>

      <Grid gap="xl" className="items-start xl:grid-cols-12">
        <Section
          title="Workshop"
          description="Every job by stage, and the latest vehicles in."
          action={
            <Link
              href="/job-cards"
              className="inline-flex items-center gap-1 font-medium text-primary hover:text-primary-hover"
            >
              All job cards
              <ArrowRight className="size-4" />
            </Link>
          }
          className="xl:col-span-8"
        >
          <Suspense fallback={<Skeleton className="h-80 rounded-xl" />}>
            <WorkshopActivity organizationId={org} />
          </Suspense>
        </Section>

        <Stack gap="xl" className="xl:col-span-4">
          <Section
            title="Today's appointments"
            action={
              <Link
                href="/appointments"
                className="inline-flex items-center gap-1 font-medium text-primary hover:text-primary-hover"
              >
                All
                <ArrowRight className="size-4" />
              </Link>
            }
          >
            <Suspense fallback={<Skeleton className="h-40 rounded-xl" />}>
              <TodaysAppointments organizationId={org} canCheckIn={canCheckIn} />
            </Suspense>
          </Section>
          {canInventory ? (
            <Section
              title="Low stock"
              action={
                <Link
                  href="/inventory/parts?stock=low"
                  className="inline-flex items-center gap-1 font-medium text-primary hover:text-primary-hover"
                >
                  Parts
                  <ArrowRight className="size-4" />
                </Link>
              }
            >
              <Suspense fallback={<Skeleton className="h-24 rounded-xl" />}>
                <LowStock user={user} />
              </Suspense>
            </Section>
          ) : null}
        </Stack>
      </Grid>

      {canFinance ? (
        <Section
          title="Money today"
          description="Invoiced and collected today, and what customers still owe."
        >
          <Suspense fallback={<Skeleton className="h-24 rounded-xl" />}>
            <FinanceStrip organizationId={org} />
          </Suspense>
        </Section>
      ) : null}
    </Stack>
  );
}

/* ------------------------------------------------------------------------ */

/** The headline: how many vehicles are here, with the day's key counts beside it. */
async function RightNow({ organizationId }: { organizationId: string }) {
  const flow = await getWorkshopFlow(organizationId);
  const facts = [
    { label: 'Appointments today', value: flow.todaysAppointments, href: '/appointments' },
    {
      label: 'Ready for collection',
      value: flow.actions.ready + flow.actions.toDeliver,
      href: '/job-cards?status=READY',
    },
    { label: 'Waiting for the customer', value: flow.actions.waitingApproval, href: '/approvals' },
  ];
  return (
    <section className="relative flex flex-col gap-6 overflow-hidden rounded-2xl bg-sidebar px-6 py-7 text-sidebar-foreground shadow-raised sm:flex-row sm:items-center sm:justify-between sm:px-8">
      {/* A violet wash keeps the anchor strip from reading as a plain black bar. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-primary/25 blur-3xl"
      />
      <Link href="/job-cards" className="group relative flex items-baseline gap-3">
        <span className="text-5xl leading-none font-semibold tracking-[-0.03em] tabular-nums">
          {flow.vehiclesCurrentlyIn}
        </span>
        <span className="text-base text-sidebar-foreground/80 transition-colors group-hover:text-sidebar-foreground">
          {flow.vehiclesCurrentlyIn === 1 ? 'vehicle' : 'vehicles'} in the workshop
        </span>
      </Link>
      <div className="relative grid grid-cols-3 gap-4 sm:gap-8">
        {facts.map((fact) => (
          <Link
            key={fact.label}
            href={fact.href}
            className="group flex flex-col gap-1 rounded-lg px-3 py-2 transition-colors hover:bg-white/[0.07] sm:-mx-1"
          >
            <span className="text-2xl leading-none font-semibold tabular-nums">{fact.value}</span>
            <span className="text-xs text-sidebar-foreground/70 transition-colors group-hover:text-sidebar-foreground">
              {fact.label}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

interface ActionTile {
  key: string;
  count: number;
  label: string;
  next: string;
  href: string;
  icon: LucideIcon;
}

/** One tile per next step in the workflow. Tiles with nothing waiting stay in place, dimmed, so the layout never jumps. */
async function ActionBoard({ organizationId }: { organizationId: string }) {
  const { actions } = await getWorkshopFlow(organizationId);
  const tiles: ActionTile[] = [
    {
      key: 'approval',
      count: actions.waitingApproval,
      label: 'Waiting for customer approval',
      next: 'Follow up the quotation',
      href: '/approvals',
      icon: BadgeCheck,
    },
    {
      key: 'approved',
      count: actions.approved,
      label: 'Approved',
      next: 'Start the repair',
      href: '/job-cards?status=APPROVED',
      icon: Wrench,
    },
    {
      key: 'repair',
      count: actions.inRepair,
      label: 'Under repair',
      next: 'Record parts and labour',
      href: '/job-cards?status=REPAIR',
      icon: Wrench,
    },
    {
      key: 'qc',
      count: actions.qualityCheck,
      label: 'Quality check',
      next: 'Check and pass the work',
      href: '/job-cards?status=QUALITY_CHECK',
      icon: ShieldCheck,
    },
    {
      key: 'ready',
      count: actions.ready,
      label: 'Ready — not invoiced',
      next: 'Create the invoice',
      href: '/job-cards?status=READY',
      icon: Receipt,
    },
    {
      key: 'payment',
      count: actions.awaitingPayment,
      label: 'Awaiting payment',
      next: 'Take payment',
      href: '/job-cards?status=INVOICED',
      icon: Wallet,
    },
    {
      key: 'deliver',
      count: actions.toDeliver,
      label: 'Paid — ready to hand over',
      next: 'Deliver the vehicle',
      href: '/job-cards?status=PAID',
      icon: KeyRound,
    },
    {
      key: 'quote',
      count: actions.toQuote,
      label: 'To diagnose or quote',
      next: 'Prepare the estimate',
      href: '/estimates',
      icon: FileText,
    },
  ];
  const extras = [
    actions.toInspect > 0
      ? { label: `${actions.toInspect} to inspect`, href: '/inspections', icon: ClipboardCheck }
      : null,
    actions.onHold > 0
      ? { label: `${actions.onHold} on hold`, href: '/job-cards?status=ON_HOLD', icon: PauseCircle }
      : null,
  ].filter((item) => item !== null);

  return (
    <div className="flex flex-col gap-3">
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => {
          const active = tile.count > 0;
          const Icon = tile.icon;
          return (
            <li key={tile.key}>
              <Link
                href={tile.href}
                className={cn(
                  'group relative flex h-full min-h-28 flex-col justify-between gap-3 overflow-hidden rounded-xl border p-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-5',
                  'transition-[transform,box-shadow,border-color] duration-200 ease-out motion-reduce:transition-none',
                  active
                    ? 'border-border/70 bg-card shadow-card hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-raised'
                    : 'border-dashed border-border bg-transparent hover:bg-card/60',
                )}
              >
                {/* A tile with work waiting wears the accent; an empty one stays quiet. */}
                {active ? (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-[3px] bg-primary opacity-70 transition-opacity group-hover:opacity-100"
                  />
                ) : null}
                <div className="flex items-start justify-between gap-3">
                  <span
                    className={cn(
                      'text-[32px] leading-none font-semibold tracking-[-0.02em] tabular-nums',
                      active ? 'text-foreground' : 'text-foreground/25',
                    )}
                  >
                    {tile.count}
                  </span>
                  <span
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                      active
                        ? 'bg-accent text-primary group-hover:bg-primary group-hover:text-primary-foreground'
                        : 'text-muted-foreground/40',
                    )}
                  >
                    <Icon className="size-[18px]" />
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className={cn('text-sm font-medium', !active && 'text-muted-foreground')}>
                    {tile.label}
                  </span>
                  {active ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                      {tile.next}
                      <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground/70">Nothing waiting</span>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      {extras.length ? (
        <div className="flex flex-wrap gap-2">
          {extras.map((extra) => {
            const Icon = extra.icon;
            return (
              <Link
                key={extra.href}
                href={extra.href}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-border bg-card px-3.5 text-sm hover:bg-muted"
              >
                <Icon className="size-4 text-muted-foreground" />
                {extra.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

async function WorkshopActivity({ organizationId }: { organizationId: string }) {
  const [flow, recent] = await Promise.all([
    getWorkshopFlow(organizationId),
    getRecentJobCards(organizationId),
  ]);

  return (
    <Panel padding="none">
      <div className="p-4 sm:p-6">
        <WorkshopFlowRow stages={flow.workflowStages} />
      </div>
      <div className="border-t border-border">
        <p className="px-4 pt-5 pb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase sm:px-6">
          Latest check-ins
        </p>
        {recent.length === 0 ? (
          <div className="px-4 pb-6 sm:px-6">
            <EmptyState
              variant="inline"
              icon={ClipboardList}
              title="No vehicles in the workshop"
              description="Checked-in vehicles appear here as soon as their job card opens."
              action={<QuickAction href="/check-in" icon={LogIn} label="Check in vehicle" />}
            />
          </div>
        ) : (
          <ul className="divide-y divide-border pb-1">
            {recent.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/job-cards/${job.id}`}
                  className="flex min-h-14 items-center gap-4 px-4 py-2.5 transition-colors hover:bg-muted/60 sm:px-6"
                >
                  <VehiclePlate
                    plateNumber={job.vehicle.plateNumber}
                    className="w-28 justify-center px-2 py-0.5 text-xs"
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="truncate text-sm font-medium">
                      {job.vehicle.make} {job.vehicle.model}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      <span className="font-medium text-foreground/70">{job.jobNumber}</span> ·{' '}
                      {job.vehicle.customer.name}
                    </p>
                  </div>
                  <JobStatusBadge status={job.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

async function TodaysAppointments({
  organizationId,
  canCheckIn,
}: {
  organizationId: string;
  canCheckIn: boolean;
}) {
  const appointments = await getTodaysAppointments(organizationId);
  if (appointments.length === 0) {
    return (
      <Panel>
        <EmptyState
          variant="inline"
          icon={CalendarDays}
          title="No appointments today"
          description="Walk-ins can be checked in any time."
          action={
            canCheckIn ? (
              <QuickAction href="/appointments/new" icon={CalendarPlus} label="Book one" />
            ) : undefined
          }
        />
      </Panel>
    );
  }
  return (
    <Panel padding="none">
      <ul className="divide-y divide-border">
        {appointments.map((appointment) => (
          <li key={appointment.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
            <span className="w-16 shrink-0 text-sm font-semibold tabular-nums">
              {formatTime(appointment.scheduledAt)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {appointment.customer.name}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {appointment.vehicle
                  ? `${appointment.vehicle.plateNumber} · ${appointment.vehicle.make} ${appointment.vehicle.model}`
                  : 'Vehicle not recorded'}
              </span>
            </span>
            {appointment.status === 'CHECKED_IN' || appointment.status === 'COMPLETED' ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                <CheckCircle2 className="size-3.5" />
                In
              </span>
            ) : canCheckIn ? (
              <Link
                href={`/check-in?appointment=${appointment.id}`}
                className="inline-flex h-9 shrink-0 items-center rounded-lg border border-border px-3 text-xs font-medium hover:bg-muted"
              >
                Check in
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

async function LowStock({ user }: { user: AuthenticatedUser }) {
  const parts = await getLowStock(user);
  if (parts.length === 0) {
    return (
      <Panel>
        <EmptyState
          variant="inline"
          tone="success"
          icon={PackageCheck}
          title="Stock levels are healthy"
          description="No part is at or below its minimum."
        />
      </Panel>
    );
  }
  return (
    <Panel padding="none">
      <ul className="divide-y divide-border">
        {parts.slice(0, 5).map((part) => (
          <li key={part.id}>
            <Link
              href={`/inventory/parts/${part.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-muted/60 sm:px-5"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{part.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{part.sku}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-semibold tabular-nums">
                  {formatMilli(part.onHandMilli)}{' '}
                  <span className="text-xs font-normal text-muted-foreground">
                    {part.unitOfMeasure}
                  </span>
                </span>
                <StockPill state={part.state} className="mt-0.5" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {parts.length > 5 ? (
        <Link
          href="/inventory/parts?stock=low"
          className="block border-t border-border px-4 py-2.5 text-sm font-medium text-primary sm:px-5"
        >
          {parts.length - 5} more
        </Link>
      ) : null}
    </Panel>
  );
}

async function FinanceStrip({ organizationId }: { organizationId: string }) {
  const finance = await getFinanceSnapshot(organizationId);
  const cells = [
    {
      label: 'Invoiced today',
      value: formatMoney(finance.todaysSales),
      hint: `${finance.todaysInvoiceCount} invoice${finance.todaysInvoiceCount === 1 ? '' : 's'}`,
      href: '/finance/invoices',
    },
    {
      label: 'Collected today',
      value: formatMoney(finance.todaysCollections),
      hint: 'Payments received',
      href: '/finance/payments',
    },
    {
      label: 'Customers owe',
      value: formatMoney(finance.customerOutstanding),
      hint: `${finance.unpaidInvoices} unpaid invoice${finance.unpaidInvoices === 1 ? '' : 's'}`,
      href: '/finance/invoices?status=unpaid',
      warn: finance.unpaidInvoices > 0,
    },
  ];
  return (
    <Panel
      padding="none"
      className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0"
    >
      {cells.map((cell) => (
        <Link
          key={cell.label}
          href={cell.href}
          className="group flex flex-col gap-1.5 p-5 transition-colors hover:bg-muted/40 sm:p-6"
        >
          <span className="text-sm text-muted-foreground">{cell.label}</span>
          <span
            className={cn(
              'text-2xl font-semibold tracking-tight tabular-nums',
              cell.warn && 'text-warning',
            )}
          >
            {cell.value}
          </span>
          <span className="text-xs text-muted-foreground group-hover:text-foreground">
            {cell.hint}
          </span>
        </Link>
      ))}
    </Panel>
  );
}

const getFinanceSnapshot = cache(fetchFinance);

function ActionsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-28 rounded-xl" />
      ))}
    </div>
  );
}
