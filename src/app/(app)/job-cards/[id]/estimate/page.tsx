import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FileText } from 'lucide-react';
import type { ApprovalMethod } from '@/generated/prisma/enums';
import { requireUser, hasPermission } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { formatCalendarDate, formatDateTime, formatMoney, localDateString } from '@/lib/format';
import { getJobWorkspace, type JobWorkspace } from '@/lib/workshop/workspace';
import { Grid, Panel, Section, Stack } from '@/components/layout/primitives';
import { JobContextHeader } from '@/components/workshop/job-context-header';
import { EstimateStatusPill } from '@/components/workshop/status-pills';
import { EmptyState } from '@/components/shared/empty-state';
import { LinkButton } from '@/components/shared/link-button';
import { cn } from '@/lib/utils';
import { resolveDefaultVatRate } from '@/lib/tax';
import { EstimateLines, trimQuantity } from '@/components/workshop/estimate-lines';
import { EstimateBuilder } from './estimate-builder';
import { CreateEstimateButton, NewLinkButton, RecordDecisionForm, ReviseEstimateButton } from './estimate-controls';

const METHOD_LABEL: Record<ApprovalMethod, string> = {
  IN_PERSON: 'in person',
  PHONE: 'by phone',
  EMAIL: 'by email',
  SMS: 'by SMS / WhatsApp',
  DIGITAL_SIGNATURE: 'by signature',
  ONLINE: 'online, on the secure quotation link',
};

export default async function EstimatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { version } = await searchParams;
  let workspace: JobWorkspace;
  try {
    workspace = await getJobWorkspace(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { jobCard, status, diagnosis, estimate: latest } = workspace;
  const canEdit = hasPermission(user, 'job_card.edit', { branchId: jobCard.branchId });
  const customer = jobCard.vehicle.customer;
  const defaultVatRate = resolveDefaultVatRate(user.organizationId);

  const shown = version ? (jobCard.estimates.find((e) => String(e.version) === version) ?? latest) : latest;
  const isLatest = shown?.id === latest?.id;
  // A first draft has nothing in the side column, so the builder gets the full width.
  const fullWidth = shown?.status === 'DRAFT' && jobCard.estimates.length === 1 && !shown.approvals[0];
  const expired =
    shown?.status === 'SENT' && shown.validUntil !== null && shown.validUntil.toISOString().slice(0, 10) < localDateString();

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <JobContextHeader jobCard={jobCard} section="Estimate" />

      {!shown ? (
        status === 'DIAGNOSIS' && canEdit ? (
          <Section title="Create the estimate" description="Price the recommended work with labour and parts. VAT is calculated per line.">
            <Panel className="flex flex-col gap-6 sm:p-8">
              {diagnosis ? (
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Recommended work</p>
                  <p className="text-sm whitespace-pre-wrap">{diagnosis.recommendedAction}</p>
                </div>
              ) : null}
              <CreateEstimateButton jobCardId={jobCard.id} />
            </Panel>
          </Section>
        ) : (
          <EmptyState
            icon={FileText}
            title="No estimate yet"
            description="An estimate is created once the vehicle has been inspected and diagnosed."
            action={
              <LinkButton href={`/job-cards/${jobCard.id}`} variant="outline">
                Back to job card
              </LinkButton>
            }
          />
        )
      ) : (
        <Grid gap="xl" className="items-start xl:grid-cols-12">
          <Section
            title={
              <span className="flex flex-wrap items-center gap-3">
                {shown.estimateNumber}
                <EstimateStatusPill status={shown.status} expired={expired} />
              </span>
            }
            description={
              shown.status === 'DRAFT'
                ? `Version ${shown.version} · draft prepared by ${shown.preparedBy.fullName}`
                : `Version ${shown.version} · sent ${shown.sentAt ? formatDateTime(shown.sentAt) : ''}${shown.sentBy ? ` by ${shown.sentBy.fullName}` : ''}${shown.validUntil ? ` · valid until ${formatCalendarDate(shown.validUntil)}` : ''}`
            }
            className={fullWidth ? 'xl:col-span-12' : 'xl:col-span-8'}
          >
            {!isLatest ? (
              <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
                You are viewing an older version. <Link href={`/job-cards/${jobCard.id}/estimate`} className="font-medium underline">See the current version</Link>.
              </div>
            ) : null}

            {shown.status === 'DRAFT' && isLatest && canEdit ? (
              <Panel className="sm:p-8">
                <EstimateBuilder
                  jobCardId={jobCard.id}
                  estimateId={shown.id}
                  customerName={customer.name}
                  recommendation={diagnosis?.recommendedAction ?? null}
                  initialValidUntil={shown.validUntil ? shown.validUntil.toISOString().slice(0, 10) : localDateString()}
                  minValidUntil={localDateString()}
                  defaultVatRate={defaultVatRate}
                  initialLines={shown.items
                    .filter((item) => item.itemType !== 'OTHER')
                    .map((item) => ({
                      key: item.id,
                      itemType: item.itemType as 'LABOUR' | 'PART',
                      description: item.description,
                      quantity: trimQuantity(item.quantity.toString()),
                      unitPrice: item.unitPrice.toString(),
                      taxRate: trimQuantity(item.taxRate?.toString() ?? defaultVatRate),
                    }))}
                />
              </Panel>
            ) : (
              <EstimateLines estimate={shown} />
            )}
          </Section>

          <Stack gap="xl" className={cn('xl:col-span-4', fullWidth && 'hidden')}>
            {shown.approvals[0] ? (
              <Section title="Customer decision">
                <Panel
                  className={cn(
                    shown.approvals[0].status === 'APPROVED' ? 'border-success/30 bg-success/5' : 'border-danger/30 bg-danger/5',
                  )}
                >
                  <p className={cn('text-lg font-semibold', shown.approvals[0].status === 'APPROVED' ? 'text-success' : 'text-danger')}>
                    {shown.approvals[0].status === 'APPROVED' ? 'Approved' : 'Rejected'}
                  </p>
                  <dl className="mt-4 grid grid-cols-[7rem_1fr] gap-x-4 gap-y-2 text-sm">
                    <dt className="text-muted-foreground">Decided by</dt>
                    <dd>{shown.approvals[0].customer.name} (customer)</dd>
                    <dt className="text-muted-foreground">How</dt>
                    <dd>{METHOD_LABEL[shown.approvals[0].approvalMethod]}</dd>
                    <dt className="text-muted-foreground">When</dt>
                    <dd>{formatDateTime(shown.approvals[0].decidedAt)}</dd>
                    <dt className="text-muted-foreground">Quotation sent by</dt>
                    <dd>{shown.sentBy?.fullName ?? '—'}</dd>
                    {shown.approvals[0].recordedBy ? (
                      <>
                        <dt className="text-muted-foreground">Recorded by</dt>
                        <dd>{shown.approvals[0].recordedBy.fullName}</dd>
                      </>
                    ) : null}
                  </dl>
                  {shown.approvals[0].notes ? (
                    <p className="mt-4 border-t border-border pt-4 text-sm whitespace-pre-wrap">“{shown.approvals[0].notes}”</p>
                  ) : null}
                  {shown.status === 'REJECTED' && isLatest && canEdit && status === 'REJECTED' ? (
                    <div className="mt-6">
                      <ReviseEstimateButton jobCardId={jobCard.id} estimateId={shown.id} variant="default" />
                    </div>
                  ) : null}
                </Panel>
              </Section>
            ) : null}

            {shown.status === 'SENT' && isLatest && canEdit ? (
              <>
                <Section
                  title={expired ? 'Quotation expired' : 'Waiting for the customer'}
                  description={
                    expired
                      ? 'The validity date has passed. Revise the estimate to send a fresh quotation.'
                      : `${customer.name} can approve or reject using their secure link. Lost the link? Create a new one.`
                  }
                >
                  <Panel className="flex flex-col gap-4">
                    {!expired ? <NewLinkButton jobCardId={jobCard.id} estimateId={shown.id} customerName={customer.name} /> : null}
                    {status === 'WAITING_APPROVAL' ? <ReviseEstimateButton jobCardId={jobCard.id} estimateId={shown.id} /> : null}
                  </Panel>
                </Section>
                {!expired ? (
                  <Section title="Record the decision" description="If the customer answers in person, by phone or by message.">
                    <Panel>
                      <RecordDecisionForm jobCardId={jobCard.id} estimateId={shown.id} />
                    </Panel>
                  </Section>
                ) : null}
              </>
            ) : null}

            {jobCard.estimates.length > 1 ? (
              <Section title="Versions">
                <Panel padding="none">
                  <ul className="divide-y divide-border">
                    {jobCard.estimates.map((estimate) => (
                      <li key={estimate.id}>
                        <Link
                          href={`/job-cards/${jobCard.id}/estimate?version=${estimate.version}`}
                          className={cn(
                            'flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-muted/60 sm:px-6',
                            estimate.id === shown.id && 'bg-muted/60',
                          )}
                        >
                          <span className="flex flex-col gap-0.5">
                            <span className="font-medium">
                              Version {estimate.version}
                              {estimate.id === latest?.id ? <span className="font-normal text-muted-foreground"> · current</span> : null}
                            </span>
                            <span className="text-xs text-muted-foreground tabular-nums">{formatMoney(estimate.totalAmount)}</span>
                          </span>
                          <EstimateStatusPill status={estimate.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Panel>
              </Section>
            ) : null}
          </Stack>
        </Grid>
      )}
    </Stack>
  );
}
