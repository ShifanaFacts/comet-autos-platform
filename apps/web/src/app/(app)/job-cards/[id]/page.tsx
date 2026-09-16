import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/authorize';
import { prisma } from '@/lib/prisma';
import { PageHeader } from '@/components/shell/page-header';
import { JobStatusBadge } from '@/components/shared/job-status-badge';
import { getAllowedNextStatuses } from '@/lib/workshop/job-status';
import { StatusChanger } from './status-changer';

const UNBUILT_TABS = [
  { label: 'Inspection', phase: 'Phase 2 (Inspection/Diagnosis)' },
  { label: 'Diagnosis', phase: 'Phase 2 (Inspection/Diagnosis)' },
  { label: 'Estimate', phase: 'Phase 3 (Estimates + Customer Approval)' },
  { label: 'Work / Parts / Labour', phase: 'Phase 4 (Repair Execution)' },
  { label: 'Quality Check', phase: 'Phase 4 (Repair Execution)' },
  { label: 'Invoice', phase: 'Phase 5 (Invoicing & Payments)' },
  { label: 'Documents', phase: 'a later phase (Object storage integration)' },
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

  return (
    <div>
      <PageHeader
        title={jobCard.jobNumber}
        description={`${jobCard.vehicle.plateNumber} — ${jobCard.vehicle.make} ${jobCard.vehicle.model} · ${jobCard.vehicle.customer.name}`}
        actions={<JobStatusBadge status={jobCard.status} />}
      />

      <div className="mb-6">
        <StatusChanger jobCardId={jobCard.id} allowedNext={getAllowedNextStatuses(jobCard.status)} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-border px-4 py-3">
          <p className="mb-2 text-sm font-medium">Overview</p>
          <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Odometer</dt>
            <dd>{jobCard.odometerReading ?? '—'}</dd>
            <dt className="text-muted-foreground">Checked in</dt>
            <dd>{jobCard.openedAt.toLocaleString('en-AE')}</dd>
            <dt className="text-muted-foreground">Complaint</dt>
            <dd className="col-span-2 whitespace-pre-wrap">{jobCard.customerComplaint ?? '—'}</dd>
          </dl>
        </div>

        <div className="rounded-lg border border-border px-4 py-3">
          <p className="mb-2 text-sm font-medium">Status history</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {jobCard.statusHistory.map((entry) => (
              <li key={entry.id} className="text-muted-foreground">
                <span className="font-medium text-foreground">{entry.toStatus}</span>
                {entry.fromStatus ? ` (from ${entry.fromStatus})` : ' (opened)'} —{' '}
                {entry.changedAt.toLocaleString('en-AE')} by {entry.changedBy.fullName}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {UNBUILT_TABS.map((tab) => (
          <div key={tab.label} className="rounded-lg border border-dashed border-border px-4 py-3">
            <p className="text-sm font-medium">{tab.label}</p>
            <p className="mt-1 text-xs text-muted-foreground">Not built yet — planned for {tab.phase}.</p>
          </div>
        ))}
      </div>
    </div>
  );
}
