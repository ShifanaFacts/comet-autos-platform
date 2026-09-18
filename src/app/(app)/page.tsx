import Link from 'next/link';
import { Suspense, cache } from 'react';
import {
  LogIn,
  ClipboardList,
  ChevronRight,
  CheckCircle2,
  PackageCheck,
  Users2,
  ArrowRight,
  CarFront,
  CalendarDays,
  BadgeCheck,
  KeyRound,
  FileText,
  Receipt,
} from 'lucide-react';
import { requireUser } from '@/lib/auth/authorize';
import {
  getWorkshopFlow as fetchWorkshopFlow,
  getFinanceSnapshot,
  getLowStockParts as fetchLowStockParts,
  getRecentJobCards,
} from '@/lib/data/dashboard';
import { Grid, PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { MoneyDisplay } from '@/components/shared/money-display';
import { EmptyState } from '@/components/shared/empty-state';
import { QuickAction } from '@/components/shared/quick-action';
import { WorkshopFlowRow } from '@/components/shared/workshop-flow-row';
import { JobStatusBadge } from '@/components/shared/job-status-badge';
import { VehiclePlate } from '@/components/shared/vehicle-plate';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

// Several independently-streamed sections read the same queries; cache()
// dedupes them to one database round-trip per request.
const getWorkshopFlow = cache(fetchWorkshopFlow);
const getLowStockParts = cache(fetchLowStockParts);

const SHORTCUTS: {
  label: string;
  detail: string;
  icon: LucideIcon;
  href?: string;
  comingIn?: string;
}[] = [
  { label: 'Check in a vehicle', detail: 'Open a new job card', icon: LogIn, href: '/check-in' },
  {
    label: 'Find a job card',
    detail: 'Search by plate, job, or customer',
    icon: ClipboardList,
    href: '/job-cards',
  },
  { label: 'Book an appointment', detail: 'Reserve a slot for a customer', icon: CalendarDays, href: '/appointments/new' },
  { label: 'Estimates to prepare', detail: 'Diagnosed jobs waiting for pricing', icon: FileText, href: '/estimates' },
  { label: 'Create invoice', detail: 'Bill a completed job', icon: Receipt, comingIn: 'Phase 5' },
];

function ShortcutRow({ label, detail, icon: Icon, href, comingIn }: (typeof SHORTCUTS)[number]) {
  const content = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{label}</span>
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      </span>
      {comingIn ? (
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {comingIn}
        </span>
      ) : (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      )}
    </>
  );
  const classes = 'flex items-center gap-4 px-4 py-3 sm:px-6';
  if (!href || comingIn) {
    return (
      <div className={cn(classes, 'opacity-60')} aria-disabled>
        {content}
      </div>
    );
  }
  return (
    <Link href={href} className={cn(classes, 'transition-colors hover:bg-muted/60')}>
      {content}
    </Link>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export default async function DashboardPage() {
  const user = await requireUser();
  const firstName = user.fullName.split(' ')[0];
  const today = new Date().toLocaleDateString('en-AE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const org = user.organizationId;

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={today}
        title={`${greeting()}, ${firstName}`}
        description="Here's where the workshop stands right now."
        actions={
          <>
            <QuickAction href="/job-cards" icon={ClipboardList} label="Job Cards" />
            <QuickAction href="/check-in" icon={LogIn} label="Check In Vehicle" primary />
          </>
        }
      />

      {/* 1. Primary operational summary */}
      <Section title="Today at a glance">
        <Suspense fallback={<SummarySkeleton />}>
          <TodaySummary organizationId={org} />
        </Suspense>
      </Section>

      {/* 2. Main workshop activity (wide) + 3. attention required (narrow) */}
      <Grid gap="xl" className="items-start xl:grid-cols-12">
        <Section
          title="Workshop activity"
          description="Every open job, by stage, and the latest vehicles in."
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
          <Suspense fallback={<ActivitySkeleton />}>
            <WorkshopActivity organizationId={org} />
          </Suspense>
        </Section>

        <Stack gap="xl" className="xl:col-span-4">
          <Section title="Attention required" description="Things waiting on someone.">
            <Suspense fallback={<Skeleton className="h-40 rounded-xl" />}>
              <AttentionList organizationId={org} />
            </Suspense>
          </Section>

          <Section title="Shortcuts" description="Common front-desk tasks.">
            <Panel padding="none">
              <ul className="divide-y divide-border">
                {SHORTCUTS.map((shortcut) => (
                  <li key={shortcut.label}>
                    <ShortcutRow {...shortcut} />
                  </li>
                ))}
              </ul>
            </Panel>
          </Section>
        </Stack>
      </Grid>

      {/* 4. Supporting information — typographic columns on the page ground, not more cards */}
      <div className="border-t border-border pt-10">
        <Grid gap="2xl" className="lg:grid-cols-12">
          <Section
            title="Finance"
            description="Today's money in and what's owed."
            className="lg:col-span-5"
          >
            <Suspense fallback={<Skeleton className="h-36 rounded-lg" />}>
              <FinanceSummary organizationId={org} />
            </Suspense>
          </Section>

          <Section
            title="Inventory"
            description="Parts at or below reorder level."
            className="lg:col-span-4"
          >
            <Suspense fallback={<Skeleton className="h-16 rounded-lg" />}>
              <InventorySummary organizationId={org} />
            </Suspense>
          </Section>

          <Section title="Team" description="Who's in today." className="lg:col-span-3">
            <EmptyState
              variant="inline"
              icon={Users2}
              title="Attendance arrives in Phase 9"
              description="Employees, attendance, and leave will show here once HR is built."
            />
          </Section>
        </Grid>
      </div>
    </Stack>
  );
}

/* ------------------------------------------------------------------------ */

function SummaryMetric({
  label,
  value,
  hint,
  icon: Icon,
  highlight,
  className,
}: {
  label: string;
  value: number;
  hint: string;
  icon: LucideIcon;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-3 p-4 sm:p-6', className)}>
      <div className="flex items-start gap-2 text-sm text-muted-foreground">
        <Icon className={cn('mt-0.5 size-4 shrink-0', highlight && 'text-warning')} />
        <span className="min-w-0">{label}</span>
      </div>
      <p
        className={cn(
          'text-3xl leading-none font-semibold tracking-tight tabular-nums sm:text-4xl',
          highlight ? 'text-warning' : 'text-foreground',
        )}
      >
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

async function TodaySummary({ organizationId }: { organizationId: string }) {
  const flow = await getWorkshopFlow(organizationId);
  const ready = flow.workflowStages.find((stage) => stage.key === 'completed')?.count ?? 0;

  return (
    <Panel padding="none" className="grid grid-cols-2 lg:grid-cols-4">
      <SummaryMetric
        icon={CarFront}
        label="In the workshop"
        value={flow.vehiclesCurrentlyIn}
        hint="Vehicles not yet handed back"
      />
      <SummaryMetric
        icon={CalendarDays}
        label="Appointments"
        value={flow.todaysAppointments}
        hint="Booked for today"
        className="border-l border-border"
      />
      <SummaryMetric
        icon={BadgeCheck}
        label="Awaiting approval"
        value={flow.waitingForApproval}
        hint="Estimates sent to customers"
        highlight={flow.waitingForApproval > 0}
        className="border-t border-border lg:border-t-0 lg:border-l"
      />
      <SummaryMetric
        icon={KeyRound}
        label="Ready for handover"
        value={ready}
        hint="Work completed"
        className="border-t border-l border-border lg:border-t-0"
      />
    </Panel>
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
        <div className="flex items-center justify-between px-4 pt-6 pb-3 sm:px-6">
          <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Latest check-ins
          </p>
        </div>

        {recent.length === 0 ? (
          <div className="px-4 pb-6 sm:px-6">
            <EmptyState
              variant="inline"
              icon={ClipboardList}
              title="No vehicles in the workshop"
              description="Checked-in vehicles appear here as soon as their job card opens."
              action={<QuickAction href="/check-in" icon={LogIn} label="Check In Vehicle" />}
            />
          </div>
        ) : (
          <ul className="divide-y divide-border pb-2">
            {recent.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/job-cards/${job.id}`}
                  className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/60 sm:px-6"
                >
                  <VehiclePlate
                    plateNumber={job.vehicle.plateNumber}
                    className="w-28 justify-center px-2 py-0.5 text-xs"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="truncate text-sm font-medium">
                      {job.vehicle.make} {job.vehicle.model}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {job.vehicle.customer.name} · {job.jobNumber}
                    </p>
                  </div>
                  <JobStatusBadge status={job.status} />
                  <span className="hidden w-28 text-right text-xs text-muted-foreground tabular-nums sm:block">
                    {job.openedAt.toLocaleString('en-AE', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

async function AttentionList({ organizationId }: { organizationId: string }) {
  const [flow, lowStockParts] = await Promise.all([
    getWorkshopFlow(organizationId),
    getLowStockParts(organizationId),
  ]);

  const items = [
    flow.waitingForApproval > 0
      ? {
          key: 'approval',
          label: 'Quotations awaiting approval',
          detail: `${plural(flow.waitingForApproval, 'estimate')} sent, no reply yet`,
          count: flow.waitingForApproval,
          href: '/approvals',
        }
      : null,
    flow.onHold > 0
      ? {
          key: 'hold',
          label: 'Vehicles on hold',
          detail: `${plural(flow.onHold, 'job')} paused`,
          count: flow.onHold,
          href: '/job-cards?status=ON_HOLD',
        }
      : null,
    lowStockParts.length > 0
      ? {
          key: 'stock',
          label: 'Parts low on stock',
          detail: `${plural(lowStockParts.length, 'part')} at or below reorder level`,
          count: lowStockParts.length,
          href: '/inventory/parts',
        }
      : null,
  ].filter((item) => item !== null);

  if (items.length === 0) {
    return (
      <Panel>
        <EmptyState
          variant="inline"
          tone="success"
          icon={CheckCircle2}
          title="All clear"
          description="No approvals, holds, or stock issues need attention right now."
        />
      </Panel>
    );
  }

  return (
    <Panel padding="none">
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              className="flex items-center gap-4 px-4 py-4 transition-colors hover:bg-muted/60 sm:px-6"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning/10 text-sm font-semibold text-warning tabular-nums">
                {item.count}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">{item.label}</span>
                <span className="truncate text-xs text-muted-foreground">{item.detail}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

async function FinanceSummary({ organizationId }: { organizationId: string }) {
  const finance = await getFinanceSnapshot(organizationId);
  const rows = [
    { label: "Today's sales", amount: finance.todaysSales },
    { label: "Today's collections", amount: finance.todaysCollections },
    {
      label: 'Customer outstanding',
      amount: finance.customerOutstanding,
      warn: finance.customerOutstanding > 0,
    },
  ];

  return (
    <dl className="divide-y divide-border border-y border-border">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-4 py-3">
          <dt className="text-sm text-muted-foreground">{row.label}</dt>
          <dd
            className={cn('text-base font-semibold', row.warn ? 'text-warning' : 'text-foreground')}
          >
            <MoneyDisplay amount={row.amount} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

async function InventorySummary({ organizationId }: { organizationId: string }) {
  const lowStockParts = await getLowStockParts(organizationId);

  if (lowStockParts.length === 0) {
    return (
      <EmptyState
        variant="inline"
        tone="success"
        icon={PackageCheck}
        title="Stock levels are healthy"
        description="No parts are below their reorder level."
      />
    );
  }

  return (
    <ul className="divide-y divide-border border-y border-border">
      {lowStockParts.slice(0, 5).map((part) => (
        <li key={part.id} className="flex items-baseline justify-between gap-4 py-3 text-sm">
          <span className="min-w-0 truncate">
            {part.name} <span className="text-muted-foreground">· {part.sku}</span>
          </span>
          <span className="shrink-0 font-medium text-warning tabular-nums">
            {part.currentStock} left
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------------ */

function SummarySkeleton() {
  return (
    <Panel padding="none" className="grid grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3 p-4 sm:p-6">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-9 w-12" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </Panel>
  );
}

function ActivitySkeleton() {
  return (
    <Panel padding="none">
      <div className="grid grid-cols-3 gap-4 p-4 sm:grid-cols-5 sm:p-6 lg:grid-cols-9">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-3">
            <Skeleton className="h-1 w-full" />
            <Skeleton className="h-6 w-8" />
            <Skeleton className="h-3 w-14" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-4 border-t border-border p-4 sm:p-6">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </Panel>
  );
}
