/*
 * The workshop's day, as lists and boards: today's documents, the job cards
 * waiting on each next step, the latest job cards, today's appointments and
 * low stock. Shared by the dashboard and the Workshop and Inventory
 * overviews; each loads its own data, so a page streams them independently.
 */
import Link from 'next/link';
import { cache } from 'react';
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
import type { AuthenticatedUser } from '@/lib/auth/session';
import {
  getLowStockParts as fetchLowStock,
  getRecentJobCards,
  getTodaysActivity,
  getTodaysAppointments,
  getWorkshopFlow as fetchWorkshopFlow,
  type ActivityKind,
} from '@/lib/data/dashboard';
import { formatMoney, formatTime } from '@/lib/format';
import { formatMilli } from '@/lib/money';
import { Panel } from '@/components/layout/primitives';
import { EmptyState } from '@/components/shared/empty-state';
import { QuickAction } from '@/components/shared/quick-action';
import { WorkshopFlowRow } from '@/components/shared/workshop-flow-row';
import { JobStatusBadge } from '@/components/shared/job-status-badge';
import { VehiclePlate } from '@/components/shared/vehicle-plate';
import { StockPill } from '@/components/inventory/stock-level';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { visibleStages } from '@/lib/workshop/stages';

// Several independently-streamed sections read the same queries; cache()
// dedupes them to one database round-trip per request.
const getWorkshopFlow = cache(fetchWorkshopFlow);
const getLowStock = cache(fetchLowStock);

const ACTIVITY: Record<ActivityKind, { label: string; icon: LucideIcon }> = {
  work_order: { label: 'Job card', icon: ClipboardList },
  quotation: { label: 'Quotation', icon: FileText },
  invoice: { label: 'Invoice', icon: Receipt },
  payment: { label: 'Payment', icon: Wallet },
};

/** Today's documents, newest first, each a tap away. */
export async function TodaysActivity({
  organizationId,
  canFinance,
  kinds,
}: {
  organizationId: string;
  canFinance: boolean;
  /** Only the kinds whose menu is shown. */
  kinds: readonly ActivityKind[];
}) {
  const items = (await getTodaysActivity(organizationId, { includeMoney: canFinance })).filter(
    (item) => kinds.includes(item.kind),
  );
  if (items.length === 0) {
    return (
      <Panel>
        <EmptyState
          variant="inline"
          icon={CalendarDays}
          title="Nothing yet today"
          description="Job cards, quotations, invoices and payments you create today appear here."
        />
      </Panel>
    );
  }
  return (
    <Panel padding="none">
      <ul className="divide-y divide-border">
        {items.map((item) => {
          const meta = ACTIVITY[item.kind];
          const Icon = meta.icon;
          return (
            <li key={`${item.kind}-${item.id}`}>
              <Link
                href={item.href}
                className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60 sm:gap-4 sm:px-6"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Icon className="size-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">
                    {meta.label} {item.number}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {item.customer}
                    {item.plateNumber ? ` · ${item.plateNumber}` : ''} · {formatTime(item.at)}
                  </span>
                </span>
                {item.amount ? (
                  <span
                    className={cn(
                      'shrink-0 text-sm font-semibold tabular-nums',
                      item.kind === 'payment' && 'text-success',
                    )}
                  >
                    {formatMoney(item.amount)}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
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
export async function ActionBoard({ organizationId }: { organizationId: string }) {
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

export async function WorkshopActivity({
  organizationId,
  detailed,
  canCheckIn,
}: {
  organizationId: string;
  /** Whether the workshop uses the standard job card, with every step. */
  detailed: boolean;
  canCheckIn: boolean;
}) {
  const [flow, recent] = await Promise.all([
    getWorkshopFlow(organizationId),
    getRecentJobCards(organizationId),
  ]);

  return (
    <Panel padding="none">
      <div className="p-4 sm:p-6">
        <WorkshopFlowRow stages={visibleStages(flow.workflowStages, detailed)} />
      </div>
      <div className="border-t border-border">
        <p className="px-4 pt-5 pb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase sm:px-6">
          Latest job cards
        </p>
        {recent.length === 0 ? (
          <div className="px-4 pb-6 sm:px-6">
            <EmptyState
              variant="inline"
              icon={ClipboardList}
              title="No open job cards"
              description="A job card appears here as soon as it is created."
              action={
                canCheckIn ? (
                  <QuickAction href="/check-in" icon={LogIn} label="New job card" />
                ) : undefined
              }
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
                      {job.customer.name}
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

export async function TodaysAppointments({
  organizationId,
  canCheckIn,
  canBook,
}: {
  organizationId: string;
  canCheckIn: boolean;
  canBook: boolean;
}) {
  const appointments = await getTodaysAppointments(organizationId);
  if (appointments.length === 0) {
    return (
      <Panel>
        <EmptyState
          variant="inline"
          icon={CalendarDays}
          title="No appointments today"
          description="Walk-ins can have a job card opened any time."
          action={
            canBook ? (
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

export async function LowStock({ user }: { user: AuthenticatedUser }) {
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

export function ActionsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-28 rounded-xl" />
      ))}
    </div>
  );
}
