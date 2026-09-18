import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, Stethoscope } from 'lucide-react';
import { requireUser, hasPermission } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { getJobWorkspace } from '@/lib/workshop/workspace';
import { employeeName, listWorkshopEmployees } from '@/lib/workshop/assignment';
import { Grid, Panel, Section, Stack } from '@/components/layout/primitives';
import { JobContextHeader } from '@/components/workshop/job-context-header';
import { InspectionResultPill } from '@/components/workshop/status-pills';
import { EmptyState } from '@/components/shared/empty-state';
import { LinkButton } from '@/components/shared/link-button';
import { DiagnosisForm } from './diagnosis-form';

export default async function DiagnosisPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let workspace;
  try {
    workspace = await getJobWorkspace(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { jobCard, status, inspection, diagnosis, estimate, primaryTechnician } = workspace;
  const canEdit = hasPermission(user, 'job_card.edit', { branchId: jobCard.branchId });
  const flagged = inspection?.items.filter((item) => item.result !== 'OK') ?? [];

  const editable =
    canEdit &&
    ((status === 'INSPECTION' && inspection?.status === 'COMPLETED') ||
      status === 'DIAGNOSIS' ||
      (status === 'ESTIMATE' && estimate?.status === 'DRAFT' && estimate.version === 1));

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <JobContextHeader jobCard={jobCard} section="Diagnosis" />

      <Grid gap="xl" className="items-start lg:grid-cols-12">
        {/* What we know: complaint → observed findings */}
        <Stack gap="xl" className="lg:col-span-5">
          <Section title="1. Customer complaint">
            <Panel>
              <p className="text-sm whitespace-pre-wrap">{jobCard.customerComplaint ?? '—'}</p>
            </Panel>
          </Section>

          <Section
            title="2. Observed findings"
            description={
              inspection
                ? `From the inspection by ${employeeName(inspection.inspectedByEmployee)}`
                : 'No inspection recorded yet.'
            }
            action={
              inspection ? (
                <Link href={`/job-cards/${jobCard.id}/inspection`} className="font-medium text-primary hover:text-primary-hover">
                  Full report
                </Link>
              ) : null
            }
          >
            <Panel padding="none">
              {inspection?.summary ? (
                <p className="border-b border-border px-4 py-4 text-sm whitespace-pre-wrap sm:px-6">{inspection.summary}</p>
              ) : null}
              {flagged.length > 0 ? (
                <ul className="divide-y divide-border">
                  {flagged.map((item) => (
                    <li key={item.id} className="flex items-start gap-3 px-4 py-3 text-sm sm:px-6">
                      <InspectionResultPill result={item.result} />
                      <span className="min-w-0">
                        <span className="font-medium">{item.description}</span>
                        {item.notes ? <span className="block text-muted-foreground">{item.notes}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-4 text-sm text-muted-foreground sm:px-6">
                  {inspection ? 'The inspection found no problems.' : 'Nothing observed yet.'}
                </p>
              )}
            </Panel>
          </Section>
        </Stack>

        {/* What we conclude: diagnosis → recommendation */}
        <Section
          title="3. Diagnosis & recommendation"
          description={
            diagnosis
              ? `Recorded by ${employeeName(diagnosis.diagnosedByEmployee)} · ${formatDateTime(diagnosis.diagnosedAt)}`
              : 'What is wrong, and the work needed to fix it.'
          }
          className="lg:col-span-7"
        >
          {editable ? (
            <Panel className="sm:p-8">
              <DiagnosisForm
                jobCardId={jobCard.id}
                isCorrection={Boolean(diagnosis)}
                employees={(await listWorkshopEmployees(user)).map((e) => ({ id: e.id, name: employeeName(e), jobTitle: e.jobTitle }))}
                initial={{
                  employeeId: diagnosis?.diagnosedByEmployee.id ?? inspection?.inspectedByEmployee.id ?? primaryTechnician?.id ?? null,
                  findings: diagnosis?.findings ?? '',
                  recommendedAction: diagnosis?.recommendedAction ?? '',
                }}
              />
            </Panel>
          ) : diagnosis ? (
            <Panel>
              <dl className="flex flex-col gap-6 text-sm">
                <div className="flex flex-col gap-2">
                  <dt className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Diagnosis</dt>
                  <dd className="whitespace-pre-wrap">{diagnosis.findings}</dd>
                </div>
                <div className="flex flex-col gap-2">
                  <dt className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Recommended work</dt>
                  <dd className="whitespace-pre-wrap">{diagnosis.recommendedAction ?? '—'}</dd>
                </div>
              </dl>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
                <p className="text-sm text-muted-foreground">
                  {estimate && estimate.status !== 'DRAFT'
                    ? 'Locked — the quotation sent to the customer is based on this diagnosis.'
                    : 'Read only.'}
                </p>
                <LinkButton href={`/job-cards/${jobCard.id}/estimate`}>
                  {estimate ? 'Open estimate' : 'Create estimate'}
                  <ArrowRight />
                </LinkButton>
              </div>
            </Panel>
          ) : (
            <EmptyState
              icon={Stethoscope}
              title={inspection?.status === 'COMPLETED' ? 'No diagnosis yet' : 'Finish the inspection first'}
              description={
                inspection?.status === 'COMPLETED'
                  ? "You don't have permission to record diagnoses."
                  : 'A diagnosis is recorded once the inspection is complete.'
              }
              action={
                status === 'ARRIVED' || status === 'INSPECTION' ? (
                  <LinkButton href={`/job-cards/${jobCard.id}/inspection`} variant="outline">
                    Go to inspection
                  </LinkButton>
                ) : undefined
              }
            />
          )}
        </Section>
      </Grid>
    </Stack>
  );
}
