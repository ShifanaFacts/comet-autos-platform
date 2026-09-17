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
import { EstimateBuilder } from './estimate-builder';
import { CreateEstimateButton, NewLinkButton, RecordDecisionForm, ReviseEstimateButton } from './estimate-controls';

const METHOD_LABEL: Record<ApprovalMethod, string> = {
  IN_PERSON: 'in person',
  PHONE: 'by phone',
  EMAIL: 'by email',
  SMS: 'by SMS / WhatsApp',
  DIGITAL_SIGNATURE: 'through the secure online link',
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
  const { jobCard, diagnosis, estimate: latest } = workspace;
  const canEdit = hasPermission(user, 'job_card.edit', { branchId: jobCard.branchId });
  const customer = jobCard.vehicle.customer;

  const shown = version ? (jobCard.estimates.find((e) => String(e.version) === version) ?? latest) : latest;
  const isLatest = shown?.id === latest?.id;
  const expired =
    shown?.status === 'SENT' && shown.validUntil !== null && shown.validUntil.toISOString().slice(0, 10) < localDateString();

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <JobContextHeader jobCard={jobCard} section="Estimate" />

      {!shown ? (
        jobCard.status === 'DIAGNOSED' && canEdit ? (
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
            className="xl:col-span-8"
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
                  initialLines={shown.items
                    .filter((item) => item.itemType !== 'OTHER')
                    .map((item) => ({
                      key: item.id,
                      itemType: item.itemType as 'LABOUR' | 'PART',
                      description: item.description,
                      quantity: trimQuantity(item.quantity.toString()),
                      unitPrice: item.unitPrice.toString(),
                      taxRate: trimQuantity(item.taxRate?.toString() ?? '5'),
                    }))}
                />
              </Panel>
            ) : (
              <EstimateLines estimate={shown} />
            )}
          </Section>

          <Stack gap="xl" className="xl:col-span-4">
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
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatDateTime(shown.approvals[0].createdAt)}, {METHOD_LABEL[shown.approvals[0].approvalMethod]}
                    {shown.approvals[0].approvalMethod === 'DIGITAL_SIGNATURE'
                      ? ` (link issued by ${shown.approvals[0].recordedBy.fullName})`
                      : ` · recorded by ${shown.approvals[0].recordedBy.fullName}`}
                  </p>
                  {shown.approvals[0].notes ? (
                    <p className="mt-4 border-t border-border pt-4 text-sm whitespace-pre-wrap">“{shown.approvals[0].notes}”</p>
                  ) : null}
                  {shown.status === 'REJECTED' && isLatest && canEdit && jobCard.status === 'ESTIMATE_SENT' ? (
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
                    {jobCard.status === 'ESTIMATE_SENT' ? <ReviseEstimateButton jobCardId={jobCard.id} estimateId={shown.id} /> : null}
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

function trimQuantity(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

function EstimateLines({ estimate }: { estimate: NonNullable<JobWorkspace['estimate']> }) {
  const groups = [
    { title: 'Labour', items: estimate.items.filter((i) => i.itemType === 'LABOUR'), qty: 'Hours' },
    { title: 'Parts', items: estimate.items.filter((i) => i.itemType !== 'LABOUR'), qty: 'Qty' },
  ].filter((group) => group.items.length > 0);

  return (
    <Panel padding="none" className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          {groups.map((group) => (
            <tbody key={group.title} className="border-b border-border">
              <tr className="bg-muted/40 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <th className="px-4 py-3 pl-6">{group.title}</th>
                <th className="w-20 px-2 py-3 text-right">{group.qty}</th>
                <th className="w-32 px-2 py-3 text-right">Price</th>
                <th className="w-20 px-2 py-3 text-right">VAT</th>
                <th className="w-32 px-4 py-3 pr-6 text-right">Amount</th>
              </tr>
              {group.items.map((item) => (
                <tr key={item.id} className="border-t border-border">
                  <td className="px-4 py-3 pl-6">{item.description}</td>
                  <td className="px-2 py-3 text-right tabular-nums">{trimQuantity(item.quantity.toString())}</td>
                  <td className="px-2 py-3 text-right tabular-nums">{formatMoney(item.unitPrice)}</td>
                  <td className="px-2 py-3 text-right text-muted-foreground tabular-nums">{trimQuantity(item.taxRate?.toString() ?? '0')}%</td>
                  <td className="px-4 py-3 pr-6 text-right font-medium tabular-nums">{formatMoney(item.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <dl className="ml-auto flex w-full flex-col gap-3 px-4 py-6 text-sm sm:w-96 sm:px-6">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="tabular-nums">{formatMoney(estimate.subtotal)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">VAT</dt>
          <dd className="tabular-nums">{formatMoney(estimate.taxAmount)}</dd>
        </div>
        <div className="flex justify-between border-t border-border pt-3 text-base font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatMoney(estimate.totalAmount)}</dd>
        </div>
      </dl>
    </Panel>
  );
}
