import Link from 'next/link';
import { Suspense } from 'react';
import {
  LogIn,
  ClipboardList,
  FileText,
  Receipt,
  ChevronRight,
  CheckCircle2,
  PackageCheck,
  Users2,
  Wallet,
  HandCoins,
  CircleAlert,
  type LucideIcon,
} from 'lucide-react';
import { requireUser } from '@/lib/auth/authorize';
import { getWorkshopFlow, getFinanceSnapshot, getLowStockParts } from '@/lib/data/dashboard';
import { MoneyDisplay } from '@/components/shared/money-display';
import { EmptyState } from '@/components/shared/empty-state';
import { QuickAction } from '@/components/shared/quick-action';
import { WorkshopFlowRow } from '@/components/shared/workshop-flow-row';
import { Skeleton } from '@/components/ui/skeleton';
import type { ReactNode } from 'react';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="animate-in fade-in duration-300">
      <div className="mb-3">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

const STAT_TONE = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  neutral: 'bg-secondary text-muted-foreground',
} as const;

function StatTile({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  tone?: keyof typeof STAT_TONE;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className={`flex size-7 shrink-0 items-center justify-center rounded-md ${STAT_TONE[tone]}`}>
          <Icon className="size-4" />
        </span>
        <p className="truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      </div>
      <p className="mt-2 truncate text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const firstName = user.fullName.split(' ')[0];
  const today = new Date().toLocaleDateString('en-AE', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="animate-in fade-in flex flex-col gap-8 duration-300">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-2xl font-semibold tracking-tight">
            {greeting()}, {firstName}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{today}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <QuickAction href="/check-in" icon={LogIn} label="Check In Vehicle" primary />
          <QuickAction href="/job-cards" icon={ClipboardList} label="Job Cards" />
          <QuickAction icon={FileText} label="New Estimate" comingIn="Phase 3" />
          <QuickAction icon={Receipt} label="Create Invoice" comingIn="Phase 5" />
        </div>
      </div>

      <Suspense fallback={<WorkshopOverviewSkeleton />}>
        <WorkshopOverview organizationId={user.organizationId} />
      </Suspense>

      <div className="grid gap-6 lg:grid-cols-2">
        <Suspense fallback={<FinanceSnapshotSkeleton />}>
          <FinanceSnapshotSection organizationId={user.organizationId} />
        </Suspense>

        <Suspense fallback={<InventorySkeleton />}>
          <InventorySection organizationId={user.organizationId} />
        </Suspense>
      </div>

      <Section title="Team">
        <EmptyState
          icon={Users2}
          title="Attendance tracking coming in Phase 9"
          description="Employees, attendance, leave, and payroll will appear here once HR is built."
        />
      </Section>
    </div>
  );
}

async function WorkshopOverview({ organizationId }: { organizationId: string }) {
  const [flow, lowStockParts] = await Promise.all([
    getWorkshopFlow(organizationId),
    getLowStockParts(organizationId),
  ]);

  const attention = [
    flow.waitingForApproval > 0
      ? {
          key: 'approval',
          label: `${flow.waitingForApproval} quotation${flow.waitingForApproval === 1 ? '' : 's'} waiting for approval`,
          href: '/job-cards?status=ESTIMATE_SENT',
        }
      : null,
    flow.onHold > 0
      ? {
          key: 'hold',
          label: `${flow.onHold} vehicle${flow.onHold === 1 ? '' : 's'} on hold`,
          href: '/job-cards?status=ON_HOLD',
        }
      : null,
    lowStockParts.length > 0
      ? {
          key: 'stock',
          label: `${lowStockParts.length} part${lowStockParts.length === 1 ? '' : 's'} low on stock`,
          href: '/job-cards',
        }
      : null,
  ].filter((item): item is { key: string; label: string; href: string } => item !== null);

  return (
    <div className="flex flex-col gap-8">
      <Section title="Attention required">
        {attention.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="You're all caught up" description="Nothing needs your attention right now." />
        ) : (
          <ul className="flex flex-col gap-2">
            {attention.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="flex items-center justify-between rounded-md border border-warning/25 bg-warning/5 px-4 py-2.5 text-sm transition-colors hover:bg-warning/10"
                >
                  <span className="font-medium text-foreground">{item.label}</span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Today's workshop"
        description={`${flow.todaysAppointments} appointment${flow.todaysAppointments === 1 ? '' : 's'} today · ${flow.vehiclesCurrentlyIn} vehicle${flow.vehiclesCurrentlyIn === 1 ? '' : 's'} currently inside`}
      >
        <WorkshopFlowRow stages={flow.workflowStages} />
      </Section>
    </div>
  );
}

async function FinanceSnapshotSection({ organizationId }: { organizationId: string }) {
  const finance = await getFinanceSnapshot(organizationId);
  return (
    <Section title="Finance snapshot">
      <div className="grid grid-cols-3 gap-3">
        <StatTile
          label="Today's sales"
          value={<MoneyDisplay amount={finance.todaysSales} />}
          icon={Wallet}
          tone="success"
        />
        <StatTile
          label="Collections"
          value={<MoneyDisplay amount={finance.todaysCollections} />}
          icon={HandCoins}
          tone="success"
        />
        <StatTile
          label="Outstanding"
          value={<MoneyDisplay amount={finance.customerOutstanding} />}
          icon={CircleAlert}
          tone="warning"
        />
      </div>
    </Section>
  );
}

async function InventorySection({ organizationId }: { organizationId: string }) {
  const lowStockParts = await getLowStockParts(organizationId);
  return (
    <Section title="Inventory">
      {lowStockParts.length === 0 ? (
        <EmptyState icon={PackageCheck} title="Inventory looks healthy" description="No parts are below their reorder level." />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {lowStockParts.map((part) => (
            <li key={part.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span>
                {part.name} <span className="text-muted-foreground">({part.sku})</span>
              </span>
              <span className="font-medium text-warning">{part.currentStock} left</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function WorkshopOverviewSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <Skeleton className="mb-3 h-4 w-32" />
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
      <div>
        <Skeleton className="mb-3 h-4 w-32" />
        <div className="flex gap-1">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-[92px] shrink-0 rounded-md" />
          ))}
        </div>
      </div>
    </div>
  );
}

function FinanceSnapshotSkeleton() {
  return (
    <div>
      <Skeleton className="mb-3 h-4 w-28" />
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

function InventorySkeleton() {
  return (
    <div>
      <Skeleton className="mb-3 h-4 w-20" />
      <Skeleton className="h-24 rounded-lg" />
    </div>
  );
}
