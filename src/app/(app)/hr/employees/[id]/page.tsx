import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, ClipboardCheck, Pencil, ShieldCheck, Wrench } from 'lucide-react';
import { hasPermission, requireUser } from '@/lib/auth/authorize';
import { getEmployeeDetail } from '@/lib/hr/employees';
import { NotFoundError } from '@/lib/errors';
import { formatDate, formatDateTime } from '@/lib/format';
import { Grid, PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { EmptyState } from '@/components/shared/empty-state';
import { JobStatusBadge } from '@/components/shared/job-status-badge';
import { LinkButton } from '@/components/shared/link-button';
import { StatusPill } from '@/components/shared/status-pill';
import { VehiclePlate } from '@/components/shared/vehicle-plate';

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!hasPermission(user, 'payroll.view')) return <AccessDenied what="the team" />;
  const { id } = await params;

  let detail;
  try {
    detail = await getEmployeeDetail(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { employee, openJobs, recentLabour, counts } = detail;
  const canManage = hasPermission(user, 'payroll.create');

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link href="/hr/employees" className="hover:text-foreground">
            Team
          </Link>
        }
        title={
          <>
            {employee.name}
            {employee.isActive ? null : <StatusPill tone="neutral">Left</StatusPill>}
          </>
        }
        description={
          [employee.jobTitle, employee.department, employee.branch.name]
            .filter(Boolean)
            .join(' · ') || 'No job title recorded.'
        }
        actions={
          canManage ? (
            <LinkButton href={`/hr/employees/${employee.id}/edit`} variant="outline" size="lg">
              <Pencil />
              Edit
            </LinkButton>
          ) : null
        }
      />

      <Grid gap="xl" className="items-start xl:grid-cols-12">
        <Stack gap="2xl" className="xl:col-span-8">
          <Section
            title="Jobs in progress"
            description="Vehicles this person is responsible for right now."
          >
            {openJobs.length === 0 ? (
              <Panel>
                <p className="text-sm text-muted-foreground">No open jobs assigned.</p>
              </Panel>
            ) : (
              <Panel padding="none" className="overflow-hidden">
                <ul className="divide-y divide-border">
                  {openJobs.map((assignment) => (
                    <li key={assignment.id}>
                      <Link
                        href={`/job-cards/${assignment.jobCard.id}`}
                        className="flex items-center gap-4 px-4 py-4 hover:bg-muted/60 sm:px-6"
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                          <span className="flex flex-wrap items-center gap-2">
                            <VehiclePlate
                              plateNumber={assignment.jobCard.vehicle.plateNumber}
                              className="px-2 py-0.5 text-xs"
                            />
                            <span className="text-sm font-medium">
                              {assignment.jobCard.vehicle.make} {assignment.jobCard.vehicle.model}
                            </span>
                            {assignment.assignmentRole === 'PRIMARY' ? (
                              <StatusPill tone="primary">Lead</StatusPill>
                            ) : null}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            <span className="font-mono">{assignment.jobCard.jobNumber}</span> ·{' '}
                            {assignment.jobCard.customer.name}
                          </span>
                        </div>
                        <JobStatusBadge status={assignment.jobCard.status} />
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </Section>

          <Section title="Recent labour" description="The last hours recorded against this person.">
            {recentLabour.length === 0 ? (
              <EmptyState icon={Wrench} title="No labour recorded yet" />
            ) : (
              <Panel padding="none" className="overflow-hidden">
                <ul className="divide-y divide-border">
                  {recentLabour.map((labour) => (
                    <li
                      key={labour.id}
                      className="flex items-center justify-between gap-4 px-4 py-3 sm:px-6"
                    >
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-sm">{labour.description}</span>
                        <span className="text-xs text-muted-foreground">
                          <Link
                            href={`/job-cards/${labour.jobCard.id}`}
                            className="font-mono hover:underline"
                          >
                            {labour.jobCard.jobNumber}
                          </Link>{' '}
                          · {formatDateTime(labour.performedAt)}
                        </span>
                      </div>
                      <span className="shrink-0 text-sm font-medium tabular-nums">
                        {labour.hours.toString()} h
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </Section>
        </Stack>

        <Stack gap="xl" className="xl:col-span-4">
          <Section title="Record">
            <Panel>
              <dl className="flex flex-col gap-4 text-sm">
                <div className="flex flex-col gap-1">
                  <dt className="text-xs font-medium text-muted-foreground">Employee code</dt>
                  <dd className="font-mono">{employee.employeeCode}</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs font-medium text-muted-foreground">Contact</dt>
                  <dd>
                    {employee.phone || employee.email ? (
                      <>
                        {employee.phone ? (
                          <a
                            href={`tel:${employee.phone.replace(/[^\d+]/g, '')}`}
                            className="tabular-nums hover:underline"
                          >
                            {employee.phone}
                          </a>
                        ) : null}
                        {employee.email ? (
                          <a
                            href={`mailto:${employee.email}`}
                            className="block break-all text-muted-foreground hover:underline"
                          >
                            {employee.email}
                          </a>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-muted-foreground">Not recorded</span>
                    )}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs font-medium text-muted-foreground">Branch</dt>
                  <dd>{employee.branch.name}</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs font-medium text-muted-foreground">Joined</dt>
                  <dd className="tabular-nums">{formatDate(employee.hireDate)}</dd>
                </div>
                {employee.terminationDate ? (
                  <div className="flex flex-col gap-1">
                    <dt className="text-xs font-medium text-muted-foreground">Left</dt>
                    <dd className="tabular-nums">{formatDate(employee.terminationDate)}</dd>
                  </div>
                ) : null}
                <div className="flex flex-col gap-1">
                  <dt className="text-xs font-medium text-muted-foreground">System login</dt>
                  <dd>
                    {employee.user ? (
                      <>
                        {employee.user.email}
                        {employee.user.phone ? (
                          <span className="block text-muted-foreground">{employee.user.phone}</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-muted-foreground">
                        None — recorded against their work without signing in
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
            </Panel>
          </Section>

          <Section title="Work recorded" description="Across every job, all time.">
            <Panel padding="none">
              <ul className="divide-y divide-border text-sm">
                <li className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <ClipboardCheck className="size-4" />
                    Inspections
                  </span>
                  <span className="font-medium tabular-nums">{counts.inspections}</span>
                </li>
                <li className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <ShieldCheck className="size-4" />
                    Quality checks
                  </span>
                  <span className="font-medium tabular-nums">{counts.qualityChecks}</span>
                </li>
              </ul>
            </Panel>
          </Section>
        </Stack>
      </Grid>
    </Stack>
  );
}
