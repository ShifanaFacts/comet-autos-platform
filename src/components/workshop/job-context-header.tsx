import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { JobCardStatus } from '@/generated/prisma/enums';
import { PageHeader } from '@/components/layout/primitives';
import { JobStatusBadge } from '@/components/shared/job-status-badge';
import { VehiclePlate } from '@/components/shared/vehicle-plate';

/**
 * The header of every job-card screen. Answers "where am I, which vehicle,
 * which job" before anything else: breadcrumb, registration, vehicle,
 * customer, job number and live status.
 */
export function JobContextHeader({
  jobCard,
  section,
  description,
  actions,
}: {
  jobCard: {
    id: string;
    jobNumber: string;
    status: JobCardStatus;
    vehicle: {
      id: string;
      plateNumber: string;
      make: string;
      model: string;
      year: number | null;
      customer: { id: string; name: string; phone: string };
    };
  };
  /** Sub-page name, e.g. "Inspection". Omit on the job card itself. */
  section?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const { vehicle } = jobCard;
  return (
    <PageHeader
      eyebrow={
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 tracking-normal normal-case">
          <Link href="/job-cards" className="hover:text-foreground">
            Job Cards
          </Link>
          <ChevronRight className="size-3.5" />
          {section ? (
            <>
              <Link href={`/job-cards/${jobCard.id}`} className="hover:text-foreground">
                {jobCard.jobNumber}
              </Link>
              <ChevronRight className="size-3.5" />
              <span className="text-foreground">{section}</span>
            </>
          ) : (
            <span className="text-foreground">{jobCard.jobNumber}</span>
          )}
        </nav>
      }
      leading={<VehiclePlate plateNumber={vehicle.plateNumber} className="px-3 py-1.5 text-base" />}
      title={
        <>
          <span>
            {section ? `${section} · ` : ''}
            {vehicle.make} {vehicle.model}
            {vehicle.year ? <span className="font-normal text-muted-foreground"> {vehicle.year}</span> : null}
          </span>
          <JobStatusBadge status={jobCard.status} />
        </>
      }
      description={
        description ?? (
          <>
            <Link href={`/customers/${vehicle.customer.id}`} className="font-medium text-foreground hover:underline">
              {vehicle.customer.name}
            </Link>
            {' · '}
            {vehicle.customer.phone} · Job {jobCard.jobNumber}
          </>
        )
      }
      actions={actions}
    />
  );
}
