import { notFound } from 'next/navigation';
import { ArrowRight, ClipboardCheck } from 'lucide-react';
import { requireUser, hasPermission } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { getJobWorkspace } from '@/lib/workshop/workspace';
import { employeeName, listWorkshopEmployees } from '@/lib/workshop/assignment';
import { INSPECTION_CHECKLIST } from '@/lib/workshop/inspection';
import { Panel, Section, Stack } from '@/components/layout/primitives';
import { JobContextHeader } from '@/components/workshop/job-context-header';
import { InspectionResultPill } from '@/components/workshop/status-pills';
import { EmptyState } from '@/components/shared/empty-state';
import { LinkButton } from '@/components/shared/link-button';
import { StagePhotosPanel } from '@/components/media/stage-photos-panel';
import { InspectionChecklist, type ChecklistItem } from './inspection-checklist';
import { StartInspectionForm } from './start-inspection-form';

export default async function InspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let workspace;
  try {
    workspace = await getJobWorkspace(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { jobCard, status, inspection, primaryTechnician } = workspace;
  const canEdit = hasPermission(user, 'job_card.edit', { branchId: jobCard.branchId });

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <JobContextHeader jobCard={jobCard} section="Inspection" />

      <Panel className="flex flex-col gap-2 bg-muted/40 sm:flex-row sm:items-start sm:gap-6">
        <p className="shrink-0 text-xs font-semibold tracking-wider text-muted-foreground uppercase sm:w-44 sm:pt-0.5">
          Customer complaint
        </p>
        <p className="text-sm whitespace-pre-wrap">{jobCard.customerComplaint ?? '—'}</p>
      </Panel>

      {!inspection ? (
        status === 'ARRIVED' && canEdit ? (
          <Section
            title="Start the inspection"
            description="Starting moves the job from Arrived into Inspection."
          >
            <Panel className="max-w-2xl sm:p-8">
              <StartInspectionForm
                jobCardId={jobCard.id}
                defaultEmployeeId={primaryTechnician?.id ?? null}
                employees={(await listWorkshopEmployees(user)).map((e) => ({
                  id: e.id,
                  name: employeeName(e),
                  jobTitle: e.jobTitle,
                }))}
              />
            </Panel>
          </Section>
        ) : (
          <EmptyState
            icon={ClipboardCheck}
            title="No inspection on this job"
            description={
              status === 'ARRIVED'
                ? "You don't have permission to start inspections."
                : 'This job moved on without an inspection being recorded.'
            }
          />
        )
      ) : inspection.status === 'IN_PROGRESS' && canEdit ? (
        <InspectionChecklist
          jobCardId={jobCard.id}
          inspectionId={inspection.id}
          initialSummary={inspection.summary ?? ''}
          initialItems={buildChecklist(inspection.items)}
        />
      ) : (
        <InspectionReport
          jobCardId={jobCard.id}
          inspection={inspection}
          canDiagnose={canEdit && status === 'INSPECTION'}
        />
      )}

      {inspection ? (
        <StagePhotosPanel
          jobCardId={jobCard.id}
          branchId={jobCard.branchId}
          status={jobCard.status}
          stage="INSPECTION"
          hint="Photograph anything you flag — it is what the customer is shown."
        />
      ) : null}
    </Stack>
  );
}

/** The standard checklist merged with what has already been recorded (recorded custom items included). */
function buildChecklist(
  recorded: {
    category: string | null;
    description: string;
    result: ChecklistItem['result'];
    notes: string | null;
  }[],
): ChecklistItem[] {
  const key = (category: string, description: string) => `${category}::${description}`;
  const saved = new Map(
    recorded.map((item) => [key(item.category ?? 'Other findings', item.description), item]),
  );
  const items: ChecklistItem[] = INSPECTION_CHECKLIST.flatMap(({ category, items: descriptions }) =>
    descriptions.map((description) => {
      const match = saved.get(key(category, description));
      saved.delete(key(category, description));
      return {
        key: key(category, description),
        category,
        description,
        result: match?.result ?? 'NOT_CHECKED',
        notes: match?.notes ?? '',
      };
    }),
  );
  for (const [itemKey, item] of saved) {
    items.push({
      key: itemKey,
      category: item.category ?? 'Other findings',
      description: item.description,
      result: item.result,
      notes: item.notes ?? '',
    });
  }
  return items;
}

function InspectionReport({
  jobCardId,
  inspection,
  canDiagnose,
}: {
  jobCardId: string;
  canDiagnose: boolean;
  inspection: NonNullable<Awaited<ReturnType<typeof getJobWorkspace>>['inspection']>;
}) {
  const order = { FAILED: 0, ATTENTION_NEEDED: 1, OK: 2 } as const;
  const items = [...inspection.items].sort((x, y) => order[x.result] - order[y.result]);
  const problems = items.filter((i) => i.result !== 'OK').length;

  return (
    <Section
      title={inspection.status === 'COMPLETED' ? 'Inspection report' : 'Inspection in progress'}
      description={`Inspected by ${employeeName(inspection.inspectedByEmployee)}${
        inspection.status === 'COMPLETED'
          ? ` · completed ${formatDateTime(inspection.inspectedAt)}`
          : ''
      } · ${items.length} checkpoints recorded, ${problems} need attention`}
      action={
        canDiagnose ? (
          <LinkButton href={`/job-cards/${jobCardId}/diagnosis`} size="lg">
            Record diagnosis
            <ArrowRight />
          </LinkButton>
        ) : null
      }
    >
      {inspection.summary ? (
        <Panel>
          <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Summary
          </p>
          <p className="mt-2 text-sm whitespace-pre-wrap">{inspection.summary}</p>
        </Panel>
      ) : null}
      <Panel padding="none">
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-start sm:gap-6 sm:px-6"
            >
              <div className="w-24 shrink-0">
                <InspectionResultPill result={item.result} />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-sm font-medium">
                  {item.description}
                  {item.category ? (
                    <span className="font-normal text-muted-foreground"> · {item.category}</span>
                  ) : null}
                </p>
                {item.notes ? <p className="text-sm text-muted-foreground">{item.notes}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </Section>
  );
}
