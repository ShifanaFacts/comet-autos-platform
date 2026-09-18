import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { JobCardStatus } from '@/generated/prisma/enums';
import { Panel, Section } from '@/components/layout/primitives';
import { JobStatusBadge } from '@/components/shared/job-status-badge';
import { VehiclePlate } from '@/components/shared/vehicle-plate';
import { formatDateTime } from '@/lib/format';

export interface QueueJob {
  id: string;
  jobNumber: string;
  status: JobCardStatus;
  openedAt: Date;
  customerComplaint: string | null;
  vehicle: { plateNumber: string; make: string; model: string; customer: { name: string; phone: string } };
  assignments: { employee: { firstName: string; lastName: string } }[];
}

/** One work queue: every job waiting at the same step, oldest first, each linking straight to the step's screen. */
export function JobQueue({
  title,
  description,
  jobs,
  actionLabel,
  hrefFor,
  empty,
}: {
  title: string;
  description: string;
  jobs: QueueJob[];
  actionLabel: string;
  hrefFor: (job: QueueJob) => string;
  empty: string;
}) {
  return (
    <Section title={`${title} (${jobs.length})`} description={description}>
      {jobs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <Panel padding="none">
          <ul className="divide-y divide-border">
            {jobs.map((job) => {
              const tech = job.assignments[0]?.employee;
              return (
                <li key={job.id}>
                  <Link href={hrefFor(job)} className="flex flex-col gap-3 px-4 py-4 hover:bg-muted/60 sm:flex-row sm:items-center sm:gap-4 sm:px-6">
                    <VehiclePlate plateNumber={job.vehicle.plateNumber} className="w-28 justify-center px-2 py-0.5 text-xs" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">
                        {job.vehicle.make} {job.vehicle.model} · {job.jobNumber}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {job.vehicle.customer.name} · {job.customerComplaint ?? 'No complaint noted'}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>{tech ? `${tech.firstName} ${tech.lastName}`.trim() : 'Unassigned'}</span>
                      <span>In since {formatDateTime(job.openedAt)}</span>
                      <JobStatusBadge status={job.status} />
                      <span className="inline-flex items-center gap-1 font-medium text-primary">
                        {actionLabel}
                        <ArrowRight className="size-3.5" />
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </Section>
  );
}
