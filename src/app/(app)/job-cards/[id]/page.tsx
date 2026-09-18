import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, ClipboardCheck, FileText, Stethoscope, Wrench, Receipt, type LucideIcon } from 'lucide-react';
import { requireUser, hasPermission } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { formatCalendarDate, formatDateTime, formatMoney } from '@/lib/format';
import { getJobWorkspace, getNextAction } from '@/lib/workshop/workspace';
import { getSecondaryNextStatuses } from '@/lib/workshop/job-status';
import { employeeName, listWorkshopEmployees } from '@/lib/workshop/assignment';
import { Grid, Panel, Section, Stack } from '@/components/layout/primitives';
import { JobContextHeader } from '@/components/workshop/job-context-header';
import { NextActionPanel } from '@/components/workshop/next-action-panel';
import { TechnicianForm } from '@/components/workshop/technician-form';
import { EstimateStatusPill, InspectionResultPill } from '@/components/workshop/status-pills';
import { StatusPill } from '@/components/shared/status-pill';
import { WorkflowStepper } from '@/components/shared/workflow-stepper';
import { StatusTimeline } from '@/components/shared/status-timeline';
import { cn } from '@/lib/utils';

export default async function JobCardWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  let workspace;
  try {
    workspace = await getJobWorkspace(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { jobCard, primaryTechnician, inspection, diagnosis, estimate, estimateExpired, effectiveStatus } = workspace;
  const next = getNextAction(workspace);
  const secondary = getSecondaryNextStatuses(jobCard.status);
  const canEdit = hasPermission(user, 'job_card.edit', { branchId: jobCard.branchId });
  const canAssign = hasPermission(user, 'job_card.assign', { branchId: jobCard.branchId });
  const employees = canAssign ? await listWorkshopEmployees(user) : [];
  const isFinished = jobCard.status === 'CLOSED' || jobCard.status === 'CANCELLED';
  const base = `/job-cards/${jobCard.id}`;

  const flagged = inspection?.items.filter((item) => item.result !== 'OK') ?? [];

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <JobContextHeader jobCard={jobCard} />

      <Stack gap="lg">
        <NextActionPanel
          jobCardId={jobCard.id}
          status={jobCard.status}
          next={next}
          canHold={canEdit && secondary.includes('ON_HOLD')}
          canCancel={canEdit && secondary.includes('CANCELLED')}
        />
        <Panel className="overflow-x-auto">
          <div className="min-w-[680px]">
            <WorkflowStepper effectiveStatus={effectiveStatus} />
          </div>
        </Panel>
      </Stack>

      <Grid gap="xl" className="items-start xl:grid-cols-12">
        {/* Main column: the work itself, in workflow order */}
        <Section title="Workshop progress" description="Each step of the job, in order." className="xl:col-span-8">
          <Panel padding="none">
            <ul className="divide-y divide-border">
              <ProgressRow
                icon={ClipboardCheck}
                title="Inspection"
                href={`${base}/inspection`}
                status={
                  inspection ? (
                    inspection.status === 'COMPLETED' ? (
                      <StatusPill tone="success">Complete</StatusPill>
                    ) : (
                      <StatusPill tone="info">In progress</StatusPill>
                    )
                  ) : (
                    <StatusPill tone="neutral">Not started</StatusPill>
                  )
                }
                linkLabel={inspection ? 'Open inspection' : jobCard.status === 'RECEIVED' ? 'Start inspection' : undefined}
              >
                {inspection ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm text-muted-foreground">
                      By {employeeName(inspection.inspectedByEmployee)} · {inspection.items.length} checkpoint
                      {inspection.items.length === 1 ? '' : 's'} recorded
                      {inspection.status === 'COMPLETED' ? ` · ${formatDateTime(inspection.inspectedAt)}` : ''}
                    </p>
                    {flagged.length > 0 ? (
                      <ul className="flex flex-col gap-2">
                        {flagged.slice(0, 4).map((item) => (
                          <li key={item.id} className="flex items-start gap-3 text-sm">
                            <InspectionResultPill result={item.result} />
                            <span className="min-w-0">
                              <span className="font-medium">{item.description}</span>
                              {item.notes ? <span className="text-muted-foreground"> — {item.notes}</span> : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : inspection.items.length > 0 ? (
                      <p className="text-sm text-success">No problems found.</p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">The technician checks the vehicle against the standard checklist.</p>
                )}
              </ProgressRow>

              <ProgressRow
                icon={Stethoscope}
                title="Diagnosis"
                href={`${base}/diagnosis`}
                status={
                  diagnosis ? <StatusPill tone="success">Recorded</StatusPill> : <StatusPill tone="neutral">Not recorded</StatusPill>
                }
                linkLabel={diagnosis ? 'View diagnosis' : inspection?.status === 'COMPLETED' ? 'Record diagnosis' : undefined}
              >
                {diagnosis ? (
                  <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[9rem_1fr]">
                    <dt className="text-muted-foreground">Diagnosis</dt>
                    <dd className="whitespace-pre-wrap">{diagnosis.findings}</dd>
                    <dt className="text-muted-foreground">Recommendation</dt>
                    <dd className="whitespace-pre-wrap">{diagnosis.recommendedAction ?? '—'}</dd>
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">What is wrong, and the work recommended to fix it.</p>
                )}
              </ProgressRow>

              <ProgressRow
                icon={FileText}
                title="Estimate & approval"
                href={`${base}/estimate`}
                status={
                  estimate ? (
                    <EstimateStatusPill status={estimate.status} expired={estimateExpired} />
                  ) : (
                    <StatusPill tone="neutral">Not created</StatusPill>
                  )
                }
                linkLabel={estimate ? 'Open estimate' : jobCard.status === 'DIAGNOSED' ? 'Create estimate' : undefined}
              >
                {estimate ? (
                  <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
                    <span className="font-medium">
                      {estimate.estimateNumber}
                      {estimate.version > 1 ? <span className="text-muted-foreground"> · version {estimate.version}</span> : null}
                    </span>
                    <span className="text-base font-semibold tabular-nums">{formatMoney(estimate.totalAmount)}</span>
                    <span className="text-muted-foreground">
                      {estimate.approvals[0]
                        ? `${estimate.approvals[0].status === 'APPROVED' ? 'Approved' : 'Rejected'} ${formatDateTime(estimate.approvals[0].createdAt)}`
                        : estimate.sentAt
                          ? `Sent ${formatDateTime(estimate.sentAt)}${estimate.validUntil ? ` · valid until ${formatCalendarDate(estimate.validUntil)}` : ''}`
                          : `${estimate.items.length} line${estimate.items.length === 1 ? '' : 's'} · draft`}
                    </span>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Labour and parts priced with VAT, sent to the customer to approve.</p>
                )}
              </ProgressRow>

              <ProgressRow icon={Wrench} title="Repair & quality check" status={<StatusPill tone="neutral">Next phase</StatusPill>}>
                <p className="text-sm text-muted-foreground">Work, parts used and quality check are built in the next phase.</p>
              </ProgressRow>
              <ProgressRow icon={Receipt} title="Invoice & delivery" status={<StatusPill tone="neutral">Later phase</StatusPill>}>
                <p className="text-sm text-muted-foreground">Invoicing, payment and handover follow the repair phase.</p>
              </ProgressRow>
            </ul>
          </Panel>
        </Section>

        {/* Side column: who, what, when */}
        <Stack gap="xl" className="xl:col-span-4">
          <Section title="Visit">
            <Panel>
              <dl className="flex flex-col gap-4 text-sm">
                <DetailRow label="Customer complaint">
                  <span className="whitespace-pre-wrap">{jobCard.customerComplaint ?? '—'}</span>
                </DetailRow>
                <DetailRow label="Mileage at check-in">
                  {jobCard.odometerReading !== null ? `${jobCard.odometerReading.toLocaleString('en-AE')} km` : '—'}
                </DetailRow>
                <DetailRow label="Checked in">
                  {formatDateTime(jobCard.openedAt)} by {jobCard.createdBy.fullName}
                </DetailRow>
                <DetailRow label="Arrived as">
                  {jobCard.appointment ? `Appointment (${formatDateTime(jobCard.appointment.scheduledAt)})` : 'Walk-in'}
                </DetailRow>
                {jobCard.closedAt ? <DetailRow label="Closed">{formatDateTime(jobCard.closedAt)}</DetailRow> : null}
              </dl>
            </Panel>
          </Section>

          <Section title="Vehicle & owner">
            <Panel padding="none">
              <ul className="divide-y divide-border text-sm">
                <li>
                  <Link href={`/vehicles/${jobCard.vehicle.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/60 sm:px-6">
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-medium">
                        {jobCard.vehicle.make} {jobCard.vehicle.model} {jobCard.vehicle.year ?? ''}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {jobCard.vehicle.plateNumber}
                        {jobCard.vehicle.vin ? ` · VIN ${jobCard.vehicle.vin}` : ''} · Service history
                      </span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
                <li>
                  <Link
                    href={`/customers/${jobCard.vehicle.customer.id}`}
                    className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/60 sm:px-6"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-medium">{jobCard.vehicle.customer.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {jobCard.vehicle.customer.phone}
                        {jobCard.vehicle.customer.email ? ` · ${jobCard.vehicle.customer.email}` : ''}
                      </span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              </ul>
            </Panel>
          </Section>

          <section id="technician" className="flex scroll-mt-24 flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold tracking-tight">Technician</h2>
              <p className="text-sm text-muted-foreground">
                {primaryTechnician ? `${employeeName(primaryTechnician)} is responsible for this job.` : 'Nobody is assigned yet.'}
              </p>
            </div>
            {canAssign && !isFinished ? (
              <Panel>
                <TechnicianForm
                  jobCardId={jobCard.id}
                  currentEmployeeId={primaryTechnician?.id ?? null}
                  employees={employees.map((e) => ({ id: e.id, name: employeeName(e), jobTitle: e.jobTitle }))}
                />
              </Panel>
            ) : null}
          </section>

          <Section title="History" description="Every status change on this job.">
            <Panel>
              <StatusTimeline entries={jobCard.statusHistory} />
            </Panel>
          </Section>
        </Stack>
      </Grid>
    </Stack>
  );
}

function ProgressRow({
  icon: Icon,
  title,
  status,
  href,
  linkLabel,
  children,
}: {
  icon: LucideIcon;
  title: string;
  status: React.ReactNode;
  href?: string;
  linkLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-4 px-4 py-5 sm:px-6">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold">{title}</h3>
            {status}
          </div>
          {href && linkLabel ? (
            <Link href={href} className={cn('inline-flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-hover')}>
              {linkLabel}
              <ArrowRight className="size-4" />
            </Link>
          ) : null}
        </div>
        {children}
      </div>
    </li>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
