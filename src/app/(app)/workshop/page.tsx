import Link from 'next/link';
import { Suspense } from 'react';
import { ArrowRight, ClipboardList, LogIn } from 'lucide-react';
import { AuthError, hasPermission, requireUser } from '@/lib/auth/authorize';
import { getWorkshopOverview, type WorkshopOverview } from '@/lib/overview/workshop';
import { getWorkshopPreferences } from '@/lib/organization/settings';
import { isMenuShown } from '@/lib/nav';
import { Grid, PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { FinancePeriodPicker } from '@/components/finance/period-picker';
import { RankedBars } from '@/components/reports/charts';
import { Kpi, KpiRow } from '@/components/overview/kpi';
import { MonthlyCounts } from '@/components/overview/trend-chart';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ActionBoard,
  ActionsSkeleton,
  TodaysActivity,
  TodaysAppointments,
  WorkshopActivity,
} from '@/components/dashboard/today-sections';
import { formatMoney } from '@/lib/format';

export const metadata = { title: 'Workshop overview' };
export const dynamic = 'force-dynamic';

/*
 * Workshop overview: everything about the jobs — how many came in and went
 * out against the period before, how long a vehicle stays, where every open
 * job stands, what needs doing next, technicians' hours and the makes coming
 * in, with twelve months of jobs in and out.
 */

const PRESETS = ['week', 'month', 'last-month', 'quarter', 'year'] as const;

export default async function WorkshopOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  let data: WorkshopOverview;
  try {
    data = await getWorkshopOverview(user, {
      period: params.period ?? 'month',
      from: params.from,
      to: params.to,
    });
  } catch (error) {
    if (error instanceof AuthError) return <AccessDenied what="the workshop overview" />;
    throw error;
  }
  const scope = user.primaryBranchId ? { branchId: user.primaryBranchId } : undefined;
  const canCheckIn = hasPermission(user, 'job_card.create', scope);
  const canFinance = hasPermission(user, 'invoice.view', scope);
  const preferences = await getWorkshopPreferences(user.organizationId);
  const menu = (href: string) => isMenuShown(href, preferences);
  const detailed = preferences.detailedJobCards;

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow="Workshop"
        title="Workshop overview"
        description="Jobs in and out, how long vehicles stay, and where every open job stands."
        actions={
          <span className="flex flex-wrap gap-2">
            <Link
              href="/job-cards"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-sm font-medium hover:bg-muted"
            >
              <ClipboardList className="size-4" />
              All job cards
            </Link>
            {canCheckIn ? (
              <Link
                href="/check-in"
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-primary bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
              >
                <LogIn className="size-4" />
                New job card
              </Link>
            ) : null}
          </span>
        }
      />

      <FinancePeriodPicker period={data.period} basePath="/workshop" presets={[...PRESETS]} />

      <KpiRow>
        <Kpi
          label="Job cards opened"
          value={String(data.opened)}
          change={data.openedGrowth}
          compareLabel={data.compareLabel}
          hint={data.cancelled > 0 ? `${data.cancelled} of them cancelled` : 'Vehicles checked in'}
          href="/job-cards"
        />
        <Kpi
          label="Vehicles delivered"
          value={String(data.delivered)}
          change={data.deliveredGrowth}
          compareLabel={data.compareLabel}
          hint="Handed back to the customer"
        />
        <Kpi
          label="In the workshop now"
          value={String(data.vehiclesIn)}
          hint={`${data.openNow} open job card${data.openNow === 1 ? '' : 's'}`}
          href="/job-cards"
        />
        <Kpi
          label="Average days in"
          value={data.averageDays !== null ? `${data.averageDays} days` : '—'}
          change={data.daysGrowth}
          compareLabel={data.compareLabel}
          lowerIsBetter
          hint="From check-in to hand-over, for vehicles delivered"
        />
      </KpiRow>

      <Section
        title="Jobs in and out — last 12 months"
        description="Job cards opened each month against vehicles handed back."
      >
        <Panel>
          <MonthlyCounts data={data.monthly} first="Job cards opened" second="Vehicles delivered" />
        </Panel>
      </Section>

      {detailed ? (
        <Section title="Next steps" description="Open job cards by what needs doing next.">
          <Suspense fallback={<ActionsSkeleton />}>
            <ActionBoard organizationId={user.organizationId} />
          </Suspense>
        </Section>
      ) : null}

      <Section
        title="Where the open jobs stand"
        description="Every job card by stage, and the latest ones opened."
        action={
          <Link
            href="/job-cards"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-hover"
          >
            All job cards
            <ArrowRight className="size-4" />
          </Link>
        }
      >
        <Suspense fallback={<Skeleton className="h-80 rounded-xl" />}>
          <WorkshopActivity
            organizationId={user.organizationId}
            detailed={detailed}
            canCheckIn={canCheckIn}
          />
        </Suspense>
      </Section>

      <Grid gap="xl" className="items-start lg:grid-cols-2">
        <Section
          title="Technicians"
          description={`Labour recorded in the period · ${data.totalHours || '0'} hours in all.`}
        >
          <Panel padding="none">
            {data.technicians.length ? (
              <RankedBars
                rows={data.technicians.map((row) => ({
                  key: row.id,
                  label: row.name,
                  detail: `${row.entries} entr${row.entries === 1 ? 'y' : 'ies'}${row.jobTitle ? ` · ${row.jobTitle}` : ''} · ${formatMoney(row.billed)} billed`,
                  value: `${row.hours} h`,
                  weight: row.valueFils,
                }))}
              />
            ) : (
              <p className="px-4 py-6 text-sm text-muted-foreground sm:px-6">
                No labour recorded in this period. Hours appear when technicians record work on a
                job card.
              </p>
            )}
          </Panel>
        </Section>
        <Section title="Vehicles by make" description="Job cards opened in the period.">
          <Panel padding="none">
            {data.makes.length ? (
              <RankedBars
                rows={data.makes.map((row) => ({
                  key: row.make,
                  label: row.make,
                  value: `${row.count} job${row.count === 1 ? '' : 's'}`,
                  weight: row.count,
                }))}
              />
            ) : (
              <p className="px-4 py-6 text-sm text-muted-foreground sm:px-6">
                No job cards opened in this period.
              </p>
            )}
          </Panel>
        </Section>
      </Grid>

      <Grid gap="xl" className="items-start lg:grid-cols-2">
        <Section title="Today" description="Job cards, quotations, invoices and payments today.">
          <Suspense fallback={<Skeleton className="h-40 rounded-xl" />}>
            <TodaysActivity
              organizationId={user.organizationId}
              canFinance={canFinance}
              kinds={[
                'work_order',
                ...(menu('/quotations') ? (['quotation'] as const) : []),
                ...(canFinance && menu('/finance/invoices') ? (['invoice'] as const) : []),
                ...(canFinance && menu('/finance/payments') ? (['payment'] as const) : []),
              ]}
            />
          </Suspense>
        </Section>
        {menu('/appointments') ? (
          <Section
            title="Today's appointments"
            description={`${data.todaysAppointments} booked for today.`}
          >
            <Suspense fallback={<Skeleton className="h-40 rounded-xl" />}>
              <TodaysAppointments
                organizationId={user.organizationId}
                canCheckIn={canCheckIn}
                canBook={hasPermission(user, 'appointment.create', scope)}
              />
            </Suspense>
          </Section>
        ) : null}
      </Grid>
    </Stack>
  );
}
