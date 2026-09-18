import Link from 'next/link';
import { ArrowRight, CheckCircle2, Package, ShieldCheck, Wrench, XCircle } from 'lucide-react';
import type { WorkflowStatus } from '@/lib/workshop/stages';
import type { RepairWorkspace } from '@/lib/workshop/repair';
import type { JobWorkspace } from '@/lib/workshop/workspace';
import { employeeName } from '@/lib/workshop/assignment';
import { formatDateTime, formatMoney } from '@/lib/format';
import { formatMilli, multiplyQuantity, filsToString, signedToMilli } from '@/lib/money';
import { Panel, Section, Stack } from '@/components/layout/primitives';
import { StatusPill } from '@/components/shared/status-pill';
import { VehiclePlate } from '@/components/shared/vehicle-plate';
import { EstimateStatusPill } from '@/components/workshop/status-pills';
import type { EmployeeOption } from '@/components/workshop/technician-form';
import { cn } from '@/lib/utils';
import { AdditionalWorkForm, LabourForm, PartUsageForm, QualityCheckForm } from './repair-forms';

const PROGRESS = {
  NOT_STARTED: { tone: 'neutral', label: 'To do' },
  PARTLY_DONE: { tone: 'warning', label: 'Partly done' },
  DONE: { tone: 'success', label: 'Done' },
} as const;

function NotApprovedPill() {
  return <StatusPill tone="warning">Additional · not approved</StatusPill>;
}

/** The repair workspace of the job card: shown from APPROVED onwards. */
export function RepairSections({
  workspace,
  repair,
  status,
  canEdit,
  canIssueParts,
  employees,
}: {
  workspace: JobWorkspace;
  repair: RepairWorkspace;
  status: WorkflowStatus;
  canEdit: boolean;
  canIssueParts: boolean;
  employees: EmployeeOption[];
}) {
  const { jobCard, primaryTechnician } = workspace;
  const inRepair = status === 'REPAIR';
  const qcOpen = status === 'REPAIR' || status === 'QUALITY_CHECK';
  const partLines = repair.approvedLines.filter((l) => l.itemType !== 'LABOUR');
  const labourLines = repair.approvedLines.filter((l) => l.itemType === 'LABOUR');
  const doneCount = repair.approvedLines.length - repair.remainingLines.length;
  const defaultTech = primaryTechnician?.id ?? null;
  const base = `/job-cards/${jobCard.id}`;
  const latestQc = repair.latestQualityCheck;

  return (
    <Stack gap="2xl">
      {status === 'READY' || status === 'INVOICED' || status === 'PAID' || status === 'DELIVERED' ? (
        <JobSummary workspace={workspace} repair={repair} status={status} />
      ) : null}

      {/* 1. Approved work */}
      <Section
        title="1. Approved work"
        description={
          repair.approvedLines.length
            ? `${doneCount} of ${repair.approvedLines.length} approved lines done · approved value ${formatMoney(repair.totals.approved)} excl. VAT`
            : 'No approved work yet.'
        }
      >
        <Panel padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/40 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-3 pl-6">Work</th>
                  <th className="px-2 py-3">Type</th>
                  <th className="w-28 px-2 py-3 text-right">Approved</th>
                  <th className="w-28 px-2 py-3 text-right">Done</th>
                  <th className="w-32 px-4 py-3 pr-6">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {repair.approvedLines.map((line) => (
                  <tr key={line.id}>
                    <td className="px-4 py-3 pl-6">
                      <span className="font-medium">{line.description}</span>
                      <span className="block text-xs text-muted-foreground">
                        {line.estimateNumber}
                        {line.kind === 'ADDITIONAL' ? ' · approved additional work' : ''}
                      </span>
                    </td>
                    <td className="px-2 py-3 text-muted-foreground">{line.itemType === 'LABOUR' ? 'Labour' : 'Part'}</td>
                    <td className="px-2 py-3 text-right tabular-nums">
                      {formatMilli(line.approvedQuantity)}
                      {line.itemType === 'LABOUR' ? ' h' : ''}
                    </td>
                    <td className="px-2 py-3 text-right tabular-nums">
                      {formatMilli(line.doneQuantity)}
                      {line.itemType === 'LABOUR' ? ' h' : ''}
                    </td>
                    <td className="px-4 py-3 pr-6">
                      <StatusPill tone={PROGRESS[line.progress].tone}>{PROGRESS[line.progress].label}</StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {repair.remainingLines.length > 0 ? (
            <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground sm:px-6">
              Remaining: {repair.remainingLines.map((l) => l.description).join(' · ')}
            </p>
          ) : repair.approvedLines.length ? (
            <p className="flex items-center gap-2 border-t border-border px-4 py-3 text-sm text-success sm:px-6">
              <CheckCircle2 className="size-4" />
              All approved work is recorded.
            </p>
          ) : null}
        </Panel>
      </Section>

      {/* 2. Parts used */}
      <Section
        title="2. Parts used"
        description={`${repair.partUsages.length} recorded · approved parts ${formatMoney(repair.totals.parts)} at usage price`}
      >
        <Panel padding="none" className="overflow-hidden">
          {repair.partUsages.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-muted/40 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th className="px-4 py-3 pl-6">Part</th>
                    <th className="px-2 py-3">For</th>
                    <th className="w-20 px-2 py-3 text-right">Qty</th>
                    <th className="w-28 px-2 py-3 text-right">Price</th>
                    <th className="w-28 px-2 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 pr-6">Fitted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {repair.partUsages.map((usage) => (
                    <tr key={usage.id} className={cn(!usage.estimateItemId && 'bg-warning/5')}>
                      <td className="px-4 py-3 pl-6">
                        <span className="font-medium">{usage.part.name}</span>
                        <span className="block font-mono text-xs text-muted-foreground">{usage.part.sku}</span>
                      </td>
                      <td className="px-2 py-3">{usage.estimateItem ? usage.estimateItem.description : <NotApprovedPill />}</td>
                      <td className="px-2 py-3 text-right tabular-nums">
                        {formatMilli(signedToMilli(usage.quantity))} {usage.part.unitOfMeasure}
                      </td>
                      <td className="px-2 py-3 text-right tabular-nums">{formatMoney(usage.unitPrice)}</td>
                      <td className="px-2 py-3 text-right font-medium tabular-nums">
                        {formatMoney(filsToString(multiplyQuantity(usage.quantity.toString(), usage.unitPrice.toString())))}
                      </td>
                      <td className="px-4 py-3 pr-6 text-xs text-muted-foreground">
                        {employeeName(usage.usedByEmployee)}
                        <span className="block">{formatDateTime(usage.usedAt)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="flex items-center gap-3 px-4 py-5 text-sm text-muted-foreground sm:px-6">
              <Package className="size-4" />
              No parts recorded yet.
            </p>
          )}
          {inRepair && canEdit && canIssueParts ? (
            <div className="border-t border-border bg-muted/20 px-4 py-6 sm:px-6">
              <PartUsageForm
                jobCardId={jobCard.id}
                parts={repair.partsCatalog}
                employees={employees}
                defaultEmployeeId={defaultTech}
                approvedLines={partLines.map((l) => ({
                  id: l.id,
                  description: l.description,
                  estimateNumber: l.estimateNumber,
                  remaining: formatMilli(Math.max(l.approvedQuantity - l.doneQuantity, 0)),
                  unitPrice: l.unitPrice,
                  done: l.progress === 'DONE',
                }))}
              />
            </div>
          ) : null}
        </Panel>
      </Section>

      {/* 3. Labour */}
      <Section title="3. Labour" description={`${repair.labours.length} recorded · approved labour ${formatMoney(repair.totals.labour)}`}>
        <Panel padding="none" className="overflow-hidden">
          {repair.labours.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-muted/40 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th className="px-4 py-3 pl-6">Work performed</th>
                    <th className="px-2 py-3">For</th>
                    <th className="w-20 px-2 py-3 text-right">Hours</th>
                    <th className="w-28 px-2 py-3 text-right">Rate</th>
                    <th className="w-28 px-2 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 pr-6">Technician</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {repair.labours.map((labour) => (
                    <tr key={labour.id} className={cn(!labour.estimateItemId && 'bg-warning/5')}>
                      <td className="px-4 py-3 pl-6 font-medium">{labour.description}</td>
                      <td className="px-2 py-3">{labour.estimateItem ? labour.estimateItem.description : <NotApprovedPill />}</td>
                      <td className="px-2 py-3 text-right tabular-nums">{labour.hours.toString()}</td>
                      <td className="px-2 py-3 text-right tabular-nums">{formatMoney(labour.rate)}</td>
                      <td className="px-2 py-3 text-right font-medium tabular-nums">{formatMoney(labour.amount)}</td>
                      <td className="px-4 py-3 pr-6 text-xs text-muted-foreground">
                        {employeeName(labour.performedByEmployee)}
                        <span className="block">{formatDateTime(labour.performedAt)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="flex items-center gap-3 px-4 py-5 text-sm text-muted-foreground sm:px-6">
              <Wrench className="size-4" />
              No labour recorded yet.
            </p>
          )}
          {inRepair && canEdit ? (
            <div className="border-t border-border bg-muted/20 px-4 py-6 sm:px-6">
              <LabourForm
                jobCardId={jobCard.id}
                employees={employees}
                defaultEmployeeId={defaultTech}
                approvedLines={labourLines.map((l) => ({
                  id: l.id,
                  description: l.description,
                  estimateNumber: l.estimateNumber,
                  remaining: formatMilli(l.approvedQuantity),
                  unitPrice: l.unitPrice,
                  done: l.progress === 'DONE',
                }))}
              />
            </div>
          ) : null}
        </Panel>
      </Section>

      {/* 4. Additional work / approval */}
      <Section
        title="4. Additional work"
        description="Extra work found during the repair is quoted and approved separately — never added to the approved quotation."
      >
        <Panel className="flex flex-col gap-6">
          {repair.totals.unapproved !== '0.00' ? (
            <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
              {formatMoney(repair.totals.unapproved)} of parts and labour is recorded as additional work without customer
              approval. It is not charged. Request approval below if it should be.
            </p>
          ) : null}
          {repair.additionalEstimates.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {repair.additionalEstimates.map((estimate) => (
                <li key={estimate.id}>
                  <Link href={`${base}/additional/${estimate.id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-muted/60">
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm font-medium">
                        {estimate.estimateNumber} · {formatMoney(estimate.totalAmount)}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">{estimate.notes}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <EstimateStatusPill status={estimate.status} />
                      <ArrowRight className="size-4 text-muted-foreground" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No additional work requested.</p>
          )}
          {inRepair && canEdit && !repair.pendingAdditional ? <AdditionalWorkForm jobCardId={jobCard.id} /> : null}
          {repair.pendingAdditional ? (
            <p className="text-sm text-muted-foreground">Waiting for the customer to answer {repair.pendingAdditional.estimateNumber}.</p>
          ) : null}
        </Panel>
      </Section>

      {/* 5. Quality check */}
      <section id="quality-check" className="flex scroll-mt-24 flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold tracking-tight">5. Quality check</h2>
          <p className="text-sm text-muted-foreground">
            {qcOpen ? 'Check the finished work. Passing it marks the vehicle ready for collection.' : 'Every check is kept, including failed ones.'}
          </p>
        </div>
        <Panel className="flex flex-col gap-6">
          {latestQc?.status === 'FAILED' && inRepair ? (
            <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm">
              <p className="font-semibold text-danger">Last check failed — correct this before re-checking:</p>
              <p className="mt-1 whitespace-pre-wrap">{latestQc.correctionsRequired}</p>
            </div>
          ) : null}
          {qcOpen && canEdit ? (
            <QualityCheckForm
              jobCardId={jobCard.id}
              employees={employees}
              defaultEmployeeId={defaultTech}
              remainingCount={repair.remainingLines.length}
            />
          ) : null}
          {repair.qualityChecks.length > 0 ? (
            <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {repair.qualityChecks.map((check) => (
                <li key={check.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                  {check.status === 'PASSED' ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  ) : (
                    <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />
                  )}
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="font-medium">
                      {check.status === 'PASSED' ? 'Passed' : 'Failed'}
                      <span className="font-normal text-muted-foreground">
                        {' '}
                        · {formatDateTime(check.checkedAt)} · checked by {employeeName(check.checkedByEmployee)}
                      </span>
                    </p>
                    {check.correctionsRequired ? <p>To correct: {check.correctionsRequired}</p> : null}
                    {check.notes ? <p className="text-muted-foreground">{check.notes}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : !qcOpen ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="size-4" />
              The quality check happens after the repair.
            </p>
          ) : null}
        </Panel>
      </section>
    </Stack>
  );
}

/** 6. The READY summary: everything the service advisor needs at handover. */
function JobSummary({ workspace, repair, status }: { workspace: JobWorkspace; repair: RepairWorkspace; status: WorkflowStatus }) {
  const { jobCard } = workspace;
  const passed = repair.qualityChecks.find((c) => c.status === 'PASSED');
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold tracking-tight">{status === 'READY' ? 'Ready for collection' : 'Job summary'}</h2>
        <p className="text-sm text-muted-foreground">Everything done on this visit, for the handover to the customer.</p>
      </div>
      <Panel className="flex flex-col gap-6 border-success/30">
        <div className="flex flex-wrap items-center gap-4">
          <VehiclePlate plateNumber={jobCard.vehicle.plateNumber} />
          <div className="min-w-0">
            <p className="font-medium">
              {jobCard.vehicle.make} {jobCard.vehicle.model} {jobCard.vehicle.year ?? ''} · Job {jobCard.jobNumber}
            </p>
            <p className="text-sm text-muted-foreground">
              {jobCard.vehicle.customer.name} · {jobCard.vehicle.customer.phone}
            </p>
          </div>
          {passed ? (
            <StatusPill tone="success" className="ml-auto">
              QC passed {formatDateTime(passed.checkedAt)}
            </StatusPill>
          ) : null}
        </div>
        <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Approved work</dt>
            <dd>
              {repair.approvedLines.length} lines · {formatMoney(repair.totals.approved)} excl. VAT
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Work completed</dt>
            <dd>
              {repair.approvedLines.length - repair.remainingLines.length} of {repair.approvedLines.length} approved lines
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Parts used</dt>
            <dd>
              {repair.partUsages.map((u) => u.part.name).join(', ') || '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Labour performed</dt>
            <dd>
              {repair.labours.map((l) => `${l.description} (${l.hours.toString()} h)`).join(', ') || '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Quality check</dt>
            <dd>
              {passed ? `Passed by ${employeeName(passed.checkedByEmployee)}` : '—'}
              {repair.qualityChecks.length > 1 ? ` after ${repair.qualityChecks.length - 1} failed check(s)` : ''}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Notes</dt>
            <dd>{passed?.notes ?? '—'}</dd>
          </div>
        </dl>
        {repair.totals.unapproved !== '0.00' ? (
          <p className="text-sm text-warning">
            {formatMoney(repair.totals.unapproved)} of additional work was recorded without approval and is not chargeable.
          </p>
        ) : null}
      </Panel>
    </section>
  );
}
