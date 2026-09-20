import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowRight,
  ClipboardCheck,
  FileText,
  Stethoscope,
  Wrench,
  Receipt,
  type LucideIcon,
} from 'lucide-react';
import { requireUser, hasPermission } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { formatCalendarDate, formatDateTime, formatMoney } from '@/lib/format';
import { getJobWorkspace, getNextAction } from '@/lib/workshop/workspace';
import { getSecondaryNextStatuses } from '@/lib/workshop/job-status';
import { employeeName, listWorkshopEmployees } from '@/lib/workshop/assignment';
import { Grid, Panel, Section, Stack } from '@/components/layout/primitives';
import { JobHero } from '@/components/workshop/job-hero';
import { JobQuickActions } from '@/components/workshop/job-quick-actions';
import { NextActionPanel } from '@/components/workshop/next-action-panel';
import { TechnicianForm } from '@/components/workshop/technician-form';
import { EstimateStatusPill, InspectionResultPill } from '@/components/workshop/status-pills';
import { StatusPill } from '@/components/shared/status-pill';
import { WorkflowProgress } from '@/components/shared/workflow-progress';
import { StatusTimeline } from '@/components/shared/status-timeline';
import { JobPhotos } from '@/components/media/job-photos';
import { JobSignatures } from '@/components/media/job-signatures';
import { listJobPhotos, listJobSignatures } from '@/lib/media/photos';
import { defaultMediaStage } from '@/lib/media/stages';
import { cn } from '@/lib/utils';
import { getRepairWorkspace } from '@/lib/workshop/repair';
import type { WorkflowStatus } from '@/lib/workshop/stages';
import { RepairSections } from './repair/repair-sections';
import { BillingSections } from './billing/billing-sections';
import { getBillingPreview, getJobInvoice } from '@/lib/billing/invoice';
import { getJobDocuments } from '@/lib/documents/build';
import { CustomerCommunication } from '@/components/documents/customer-communication';

const BILLING_PHASE: WorkflowStatus[] = ['READY', 'INVOICED', 'PAID', 'DELIVERED'];
const REPAIR_PHASE: WorkflowStatus[] = [
  'APPROVED',
  'REPAIR',
  'QUALITY_CHECK',
  'READY',
  'INVOICED',
  'PAID',
  'DELIVERED',
];

export default async function JobCardWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  let workspace;
  try {
    workspace = await getJobWorkspace(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const {
    jobCard,
    status,
    primaryTechnician,
    inspection,
    diagnosis,
    estimate,
    estimateExpired,
    effectiveStatus,
  } = workspace;
  const next = getNextAction(workspace);
  const secondary = getSecondaryNextStatuses(jobCard.status);
  const canEdit = hasPermission(user, 'job_card.edit', { branchId: jobCard.branchId });
  const canAssign = hasPermission(user, 'job_card.assign', { branchId: jobCard.branchId });
  const canIssueParts = hasPermission(user, 'inventory.issue', { branchId: jobCard.branchId });
  const canPay = hasPermission(user, 'payment.create', { branchId: jobCard.branchId });
  const repairPhase = REPAIR_PHASE.includes(status);
  const billingPhase = BILLING_PHASE.includes(status);
  // Independent reads, fetched together rather than one after another.
  const [employees, repair, invoice, documents, photos, signatures] = await Promise.all([
    canAssign || canEdit ? listWorkshopEmployees(user) : Promise.resolve([]),
    repairPhase ? getRepairWorkspace(user, jobCard.id) : Promise.resolve(null),
    billingPhase ? getJobInvoice(user, jobCard.id) : Promise.resolve(null),
    getJobDocuments(user, jobCard.id),
    listJobPhotos(user, jobCard.id),
    listJobSignatures(user, jobCard.id),
  ]);
  const preview = billingPhase && !invoice ? await getBillingPreview(user, jobCard.id) : null;
  const hasDocuments = documents.quotations.length > 0 || documents.invoice !== null;
  const employeeOptions = employees.map((e) => ({
    id: e.id,
    name: employeeName(e),
    jobTitle: e.jobTitle,
  }));
  const isFinished = status === 'DELIVERED' || status === 'CANCELLED';
  const base = `/job-cards/${jobCard.id}`;

  const flagged = inspection?.items.filter((item) => item.result !== 'OK') ?? [];

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <JobHero
        jobCard={jobCard}
        technician={primaryTechnician ? employeeName(primaryTechnician) : null}
      />

      <Stack gap="lg">
        <NextActionPanel
          jobCardId={jobCard.id}
          status={jobCard.status}
          next={next}
          canHold={canEdit && secondary.includes('ON_HOLD')}
          canCancel={canEdit && secondary.includes('CANCELLED')}
        />
        <Panel>
          <WorkflowProgress effectiveStatus={effectiveStatus} />
        </Panel>
      </Stack>

      <Grid gap="xl" className="items-start xl:grid-cols-12">
        {/* Main column: the work itself, in workflow order */}
        <Stack gap="2xl" className="xl:col-span-8">
          {billingPhase ? (
            <BillingSections
              workspace={workspace}
              status={status}
              invoice={invoice}
              preview={preview}
              canInvoice={hasPermission(user, 'invoice.create', { branchId: jobCard.branchId })}
              canPay={canPay}
              canDeliver={hasPermission(user, 'job_card.close', { branchId: jobCard.branchId })}
            />
          ) : null}
          {repair ? (
            <RepairSections
              workspace={workspace}
              repair={repair}
              status={status}
              canEdit={canEdit}
              canIssueParts={canIssueParts}
              employees={employeeOptions}
            />
          ) : null}
          <Section
            title={repairPhase ? 'Before the repair' : 'Workshop progress'}
            description={
              repairPhase
                ? 'Inspection, diagnosis and the approved quotation.'
                : 'Each step of the job, in order.'
            }
          >
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
                  linkLabel={
                    inspection
                      ? 'Open inspection'
                      : status === 'ARRIVED'
                        ? 'Start inspection'
                        : undefined
                  }
                >
                  {inspection ? (
                    <div className="flex flex-col gap-3">
                      <p className="text-sm text-muted-foreground">
                        By {employeeName(inspection.inspectedByEmployee)} ·{' '}
                        {inspection.items.length} checkpoint
                        {inspection.items.length === 1 ? '' : 's'} recorded
                        {inspection.status === 'COMPLETED'
                          ? ` · ${formatDateTime(inspection.inspectedAt)}`
                          : ''}
                      </p>
                      {flagged.length > 0 ? (
                        <ul className="flex flex-col gap-2">
                          {flagged.slice(0, 4).map((item) => (
                            <li key={item.id} className="flex items-start gap-3 text-sm">
                              <InspectionResultPill result={item.result} />
                              <span className="min-w-0">
                                <span className="font-medium">{item.description}</span>
                                {item.notes ? (
                                  <span className="text-muted-foreground"> — {item.notes}</span>
                                ) : null}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : inspection.items.length > 0 ? (
                        <p className="text-sm text-success">No problems found.</p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      The technician checks the vehicle against the standard checklist.
                    </p>
                  )}
                </ProgressRow>

                <ProgressRow
                  icon={Stethoscope}
                  title="Diagnosis"
                  href={`${base}/diagnosis`}
                  status={
                    diagnosis ? (
                      <StatusPill tone="success">Recorded</StatusPill>
                    ) : (
                      <StatusPill tone="neutral">Not recorded</StatusPill>
                    )
                  }
                  linkLabel={
                    diagnosis
                      ? 'View diagnosis'
                      : inspection?.status === 'COMPLETED'
                        ? 'Record diagnosis'
                        : undefined
                  }
                >
                  {diagnosis ? (
                    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[9rem_1fr]">
                      <dt className="text-muted-foreground">Diagnosis</dt>
                      <dd className="whitespace-pre-wrap">{diagnosis.findings}</dd>
                      <dt className="text-muted-foreground">Recommendation</dt>
                      <dd className="whitespace-pre-wrap">{diagnosis.recommendedAction ?? '—'}</dd>
                    </dl>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      What is wrong, and the work recommended to fix it.
                    </p>
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
                  linkLabel={
                    estimate
                      ? 'Open estimate'
                      : status === 'DIAGNOSIS'
                        ? 'Create estimate'
                        : undefined
                  }
                >
                  {estimate ? (
                    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
                      <span className="font-medium">
                        {estimate.estimateNumber}
                        {estimate.version > 1 ? (
                          <span className="text-muted-foreground">
                            {' '}
                            · version {estimate.version}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-base font-semibold tabular-nums">
                        {formatMoney(estimate.totalAmount)}
                      </span>
                      <span className="text-muted-foreground">
                        {estimate.approvals[0]
                          ? `${estimate.approvals[0].status === 'APPROVED' ? 'Approved' : 'Rejected'} ${formatDateTime(estimate.approvals[0].decidedAt)} by ${estimate.approvals[0].customer.name}${estimate.approvals[0].approvalMethod === 'ONLINE' ? ' online' : ''}`
                          : estimate.sentAt
                            ? `Sent ${formatDateTime(estimate.sentAt)}${estimate.validUntil ? ` · valid until ${formatCalendarDate(estimate.validUntil)}` : ''}`
                            : `${estimate.items.length} line${estimate.items.length === 1 ? '' : 's'} · draft`}
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Labour and parts priced with VAT, sent to the customer to approve.
                    </p>
                  )}
                </ProgressRow>

                {!repairPhase ? (
                  <ProgressRow
                    icon={Wrench}
                    title="Repair & quality check"
                    status={<StatusPill tone="neutral">After approval</StatusPill>}
                  >
                    <p className="text-sm text-muted-foreground">
                      Parts, labour and the quality check are recorded once the customer approves.
                    </p>
                  </ProgressRow>
                ) : null}
                <ProgressRow
                  icon={Receipt}
                  title="Invoice & delivery"
                  status={<StatusPill tone="neutral">Later phase</StatusPill>}
                >
                  <p className="text-sm text-muted-foreground">
                    Invoicing, payment and handover follow the repair phase.
                  </p>
                </ProgressRow>
              </ul>
            </Panel>
          </Section>

          <section id="photos" className="flex scroll-mt-24 flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold tracking-tight">Photos</h2>
              <p className="text-sm text-muted-foreground">
                What the vehicle looked like at each stage — evidence for the customer and for the
                workshop.
              </p>
            </div>
            <JobPhotos
              jobCardId={jobCard.id}
              photos={photos.map((photo) => ({
                id: photo.id,
                stage: photo.stage,
                description: photo.description,
                createdAt: photo.createdAt.toISOString(),
                uploadedBy: photo.uploadedBy?.fullName ?? 'Workshop',
              }))}
              defaultStage={defaultMediaStage(jobCard.status)}
              canEdit={canEdit && !isFinished}
            />
          </section>

          <Section
            title="Signatures"
            description="Signed approvals and handovers on this job."
          >
            <Panel padding="none">
              <JobSignatures signatures={signatures} />
            </Panel>
          </Section>
        </Stack>

        {/* Side column: who, what, when */}
        <Stack gap="xl" className="xl:col-span-4">
          {hasDocuments ? (
            <Section
              title="Customer communication"
              description="Send documents to the customer on WhatsApp."
            >
              <CustomerCommunication documents={documents} canShareQuotation={canEdit} />
            </Section>
          ) : null}

          <Section title="Visit">
            <Panel>
              <dl className="flex flex-col gap-4 text-sm">
                <DetailRow label="Customer complaint">
                  <span className="whitespace-pre-wrap">{jobCard.customerComplaint ?? '—'}</span>
                </DetailRow>
                <DetailRow label="Mileage at check-in">
                  {jobCard.odometerReading !== null
                    ? `${jobCard.odometerReading.toLocaleString('en-AE')} km`
                    : '—'}
                </DetailRow>
                <DetailRow label="Checked in">
                  {formatDateTime(jobCard.openedAt)} by {jobCard.createdBy.fullName}
                </DetailRow>
                <DetailRow label="Arrived as">
                  {jobCard.appointment
                    ? `Appointment (${formatDateTime(jobCard.appointment.scheduledAt)})`
                    : 'Walk-in'}
                </DetailRow>
                {jobCard.closedAt ? (
                  <DetailRow label="Closed">{formatDateTime(jobCard.closedAt)}</DetailRow>
                ) : null}
              </dl>
            </Panel>
          </Section>

          <Section title="Vehicle & owner">
            <Panel padding="none">
              <ul className="divide-y divide-border text-sm">
                <li>
                  <Link
                    href={`/vehicles/${jobCard.vehicle.id}`}
                    className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/60 sm:px-6"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-medium">
                        {jobCard.vehicle.make} {jobCard.vehicle.model} {jobCard.vehicle.year ?? ''}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {jobCard.vehicle.plateNumber}
                        {jobCard.vehicle.vin ? ` · VIN ${jobCard.vehicle.vin}` : ''} · Service
                        history
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
                        {jobCard.vehicle.customer.email
                          ? ` · ${jobCard.vehicle.customer.email}`
                          : ''}
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
                {primaryTechnician
                  ? `${employeeName(primaryTechnician)} is responsible for this job.`
                  : 'Nobody is assigned yet.'}
              </p>
            </div>
            {canAssign && !isFinished ? (
              <Panel>
                <TechnicianForm
                  jobCardId={jobCard.id}
                  currentEmployeeId={primaryTechnician?.id ?? null}
                  employees={employees.map((e) => ({
                    id: e.id,
                    name: employeeName(e),
                    jobTitle: e.jobTitle,
                  }))}
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

      {!isFinished ? (
        <JobQuickActions
          jobCardId={jobCard.id}
          status={status}
          canEdit={canEdit}
          canIssueParts={canIssueParts}
          canPay={canPay}
        />
      ) : null}
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
            <Link
              href={href}
              className={cn(
                'inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:text-primary-hover md:min-h-0',
              )}
            >
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
