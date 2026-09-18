import { requireUser } from '@/lib/auth/authorize';
import { getWorkQueues } from '@/lib/workshop/workspace';
import { PageHeader, Stack } from '@/components/layout/primitives';
import { JobQueue } from '@/components/workshop/job-queue';

export default async function InspectionsPage() {
  const user = await requireUser();
  const queues = await getWorkQueues(user);

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow="Workshop"
        title="Inspections"
        description="Vehicles waiting to be inspected, being inspected, and ready for diagnosis."
      />
      <JobQueue
        title="Waiting for inspection"
        description="Arrived and checked in — start the checklist."
        jobs={queues.awaitingInspection}
        actionLabel="Inspect"
        hrefFor={(job) => `/job-cards/${job.id}/inspection`}
        empty="No vehicles are waiting for inspection."
      />
      <JobQueue
        title="Inspection in progress"
        description="Checklists started but not yet completed."
        jobs={queues.inInspection}
        actionLabel="Continue"
        hrefFor={(job) => `/job-cards/${job.id}/inspection`}
        empty="No inspections are in progress."
      />
      <JobQueue
        title="Ready for diagnosis"
        description="Inspection complete — record what's wrong and the recommended work."
        jobs={queues.awaitingDiagnosis}
        actionLabel="Diagnose"
        hrefFor={(job) => `/job-cards/${job.id}/diagnosis`}
        empty="Nothing is waiting for diagnosis."
      />
    </Stack>
  );
}
