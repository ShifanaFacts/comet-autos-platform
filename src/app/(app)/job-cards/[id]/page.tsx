import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ClipboardCheck, Stethoscope, FileText, Wrench, ShieldCheck, Receipt, FileStack } from 'lucide-react';
import { requireUser } from '@/lib/auth/authorize';
import { prisma } from '@/lib/prisma';
import { JobStatusBadge } from '@/components/shared/job-status-badge';
import { WorkflowStepper } from '@/components/shared/workflow-stepper';
import { StatusTimeline } from '@/components/shared/status-timeline';
import {
  getAllowedNextStatuses,
  getPrimaryNextStatus,
  getSecondaryNextStatuses,
  getEffectiveStageStatus,
} from '@/lib/workshop/job-status';
import { StatusChanger } from './status-changer';

const UNBUILT_SECTIONS = [
  { label: 'Inspection', icon: ClipboardCheck, phase: 'Phase 2' },
  { label: 'Diagnosis', icon: Stethoscope, phase: 'Phase 2' },
  { label: 'Estimate & Approval', icon: FileText, phase: 'Phase 3' },
  { label: 'Work, Parts & Labour', icon: Wrench, phase: 'Phase 4' },
  { label: 'Quality Check', icon: ShieldCheck, phase: 'Phase 4' },
  { label: 'Invoice & Payments', icon: Receipt, phase: 'Phase 5' },
  { label: 'Documents', icon: FileStack, phase: 'a later phase' },
];

export default async function JobCardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const jobCard = await prisma.jobCard.findFirst({
    where: { id, organizationId: user.organizationId },
    include: {
      vehicle: { include: { customer: true } },
      statusHistory: { orderBy: { changedAt: 'desc' }, include: { changedBy: true } },
    },
  });

  if (!jobCard) notFound();

  const allowedNext = getAllowedNextStatuses(jobCard.status);
  const primaryNext = getPrimaryNextStatus(jobCard.status);
  const secondaryNext = getSecondaryNextStatuses(jobCard.status);
  const effectiveStatus = getEffectiveStageStatus(jobCard.status, jobCard.statusHistory);

  return (
    <div className="animate-in fade-in flex flex-col gap-6 duration-300">
      <Link
        href="/job-cards"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        Job Cards
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight">{jobCard.jobNumber}</h1>
            <JobStatusBadge status={jobCard.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {jobCard.vehicle.plateNumber} — {jobCard.vehicle.make} {jobCard.vehicle.model} ·{' '}
            {jobCard.vehicle.customer.name}
            {jobCard.odometerReading ? ` · ${jobCard.odometerReading.toLocaleString()} km` : ''}
          </p>
        </div>
      </div>

      {jobCard.status === 'ON_HOLD' ? (
        <div className="rounded-md border border-warning/30 bg-warning/5 px-4 py-2 text-sm text-warning">
          This job is on hold — paused after <strong>{effectiveStatus}</strong>.
        </div>
      ) : null}
      {jobCard.status === 'CANCELLED' ? (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">
          This job was cancelled after reaching <strong>{effectiveStatus}</strong>.
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-card px-5 py-5">
        <WorkflowStepper effectiveStatus={effectiveStatus} />
      </div>

      {allowedNext.length > 0 ? (
        <StatusChanger jobCardId={jobCard.id} primaryNext={primaryNext} secondaryNext={secondaryNext} />
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="mb-2 text-sm font-medium">Overview</p>
          <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Odometer</dt>
            <dd>{jobCard.odometerReading ? `${jobCard.odometerReading.toLocaleString()} km` : '—'}</dd>
            <dt className="text-muted-foreground">Checked in</dt>
            <dd>{jobCard.openedAt.toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' })}</dd>
            <dt className="text-muted-foreground">Complaint</dt>
            <dd className="col-span-2 whitespace-pre-wrap">{jobCard.customerComplaint ?? '—'}</dd>
          </dl>
        </div>

        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="mb-3 text-sm font-medium">History</p>
          <StatusTimeline entries={jobCard.statusHistory} />
        </div>
      </div>

      <div>
        <p className="mb-3 text-sm font-medium">Coming up</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {UNBUILT_SECTIONS.map((section) => (
            <div
              key={section.label}
              className="flex items-center gap-3 rounded-lg border border-dashed border-border px-4 py-3"
            >
              <section.icon className="size-4 shrink-0 text-muted-foreground/60" />
              <div>
                <p className="text-sm font-medium">{section.label}</p>
                <p className="text-xs text-muted-foreground">Planned for {section.phase}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
