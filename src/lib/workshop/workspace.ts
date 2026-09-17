import type { JobCardStatus } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { localDateString } from '@/lib/format';
import { getEffectiveStageStatus, JOB_STATUS_LABEL } from '@/lib/workshop/stages';
import { getManualForwardStatus } from '@/lib/workshop/job-status';

/** Everything the Job Card workspace and its sub-pages show. One query shape, used everywhere. */
export async function getJobWorkspace(user: AuthenticatedUser, jobCardId: string) {
  const jobCard = await prisma.jobCard.findFirst({
    where: { id: jobCardId, organizationId: user.organizationId },
    include: {
      branch: { select: { name: true } },
      createdBy: { select: { fullName: true } },
      appointment: { select: { scheduledAt: true, notes: true } },
      vehicle: { include: { customer: true } },
      statusHistory: {
        orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
        include: { changedBy: { select: { fullName: true } } },
      },
      assignments: {
        where: { unassignedAt: null },
        include: { employee: { select: { id: true, firstName: true, lastName: true, jobTitle: true } } },
      },
      inspections: {
        orderBy: { createdAt: 'desc' },
        include: {
          inspectedByEmployee: { select: { id: true, firstName: true, lastName: true } },
          items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        },
      },
      diagnoses: {
        orderBy: { diagnosedAt: 'desc' },
        include: { diagnosedByEmployee: { select: { id: true, firstName: true, lastName: true } } },
      },
      estimates: {
        orderBy: { version: 'desc' },
        include: {
          items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
          approvals: {
            orderBy: { createdAt: 'desc' },
            include: { recordedBy: { select: { fullName: true } } },
          },
          preparedBy: { select: { fullName: true } },
          sentBy: { select: { fullName: true } },
        },
      },
    },
  });
  // Same response for "doesn't exist" and "not yours" (authorization.md).
  if (!jobCard) throw new NotFoundError('job card');
  requirePermission(user, 'job_card.view', { branchId: jobCard.branchId });

  const primary = jobCard.assignments.find((a) => a.assignmentRole === 'PRIMARY') ?? null;
  const inspection = jobCard.inspections[0] ?? null;
  const diagnosis = jobCard.diagnoses[0] ?? null;
  const estimate = jobCard.estimates[0] ?? null;
  const effectiveStatus = getEffectiveStageStatus(jobCard.status, jobCard.statusHistory);
  const estimateExpired =
    estimate?.status === 'SENT' &&
    estimate.validUntil !== null &&
    estimate.validUntil.toISOString().slice(0, 10) < localDateString();

  return {
    jobCard,
    primaryTechnician: primary?.employee ?? null,
    inspection,
    diagnosis,
    estimate,
    estimateExpired,
    effectiveStatus,
  };
}

export type JobWorkspace = Awaited<ReturnType<typeof getJobWorkspace>>;

export type NextActionTone = 'action' | 'waiting' | 'warning' | 'done';

export interface NextAction {
  tone: NextActionTone;
  title: string;
  description: string;
  /** Primary call to action: a page to go to, or a manual status change. */
  href?: string;
  label?: string;
  manualStatus?: JobCardStatus;
}

/** "What do I do next?" — derived from the job status plus the workflow records, never stored. */
export function getNextAction(workspace: JobWorkspace): NextAction {
  const { jobCard, primaryTechnician, inspection, estimate, estimateExpired } = workspace;
  const base = `/job-cards/${jobCard.id}`;

  switch (jobCard.status) {
    case 'CANCELLED':
      return { tone: 'done', title: 'Job cancelled', description: 'No further work will be done on this job.' };
    case 'CLOSED':
      return { tone: 'done', title: 'Job closed', description: 'The vehicle has been handed back.' };
    case 'ON_HOLD':
      return {
        tone: 'warning',
        title: 'Job is on hold',
        description: `Paused at “${JOB_STATUS_LABEL[workspace.effectiveStatus]}”. Resume when the blocker is cleared.`,
        manualStatus: workspace.effectiveStatus,
        label: 'Resume job',
      };
    case 'RECEIVED':
      if (!primaryTechnician) {
        return {
          tone: 'action',
          title: 'Assign a technician',
          description: 'The vehicle has arrived. Choose who will inspect and work on it.',
          href: `${base}#technician`,
          label: 'Assign technician',
        };
      }
      return {
        tone: 'action',
        title: 'Inspect the vehicle',
        description: `${primaryTechnician.firstName} is assigned. Start the inspection checklist.`,
        href: `${base}/inspection`,
        label: 'Start inspection',
      };
    case 'INSPECTING':
      if (inspection?.status === 'COMPLETED') {
        return {
          tone: 'action',
          title: 'Record the diagnosis',
          description: 'The inspection is complete. Record what is wrong and the recommended work.',
          href: `${base}/diagnosis`,
          label: 'Record diagnosis',
        };
      }
      return {
        tone: 'action',
        title: 'Finish the inspection',
        description: 'Work through the checklist, then mark the inspection complete.',
        href: `${base}/inspection`,
        label: 'Continue inspection',
      };
    case 'DIAGNOSED':
      return estimate?.status === 'DRAFT'
        ? {
            tone: 'action',
            title: 'Finish and send the estimate',
            description: 'Add the labour and parts, check the total, then send it to the customer.',
            href: `${base}/estimate`,
            label: 'Open estimate',
          }
        : {
            tone: 'action',
            title: 'Create the estimate',
            description: 'Price the recommended work so the customer can approve it.',
            href: `${base}/estimate`,
            label: 'Create estimate',
          };
    case 'ESTIMATE_SENT':
      if (estimate?.status === 'REJECTED') {
        return {
          tone: 'warning',
          title: 'Customer rejected the estimate',
          description: 'Revise the quotation and send it again, or cancel the job.',
          href: `${base}/estimate`,
          label: 'Revise estimate',
        };
      }
      if (estimate?.status === 'DRAFT') {
        return {
          tone: 'action',
          title: 'Send the revised estimate',
          description: `Version ${estimate.version} is a draft. Send it when it's ready.`,
          href: `${base}/estimate`,
          label: 'Open estimate',
        };
      }
      if (estimateExpired) {
        return {
          tone: 'warning',
          title: 'Quotation expired',
          description: 'The customer did not respond before the validity date. Revise and resend.',
          href: `${base}/estimate`,
          label: 'Revise estimate',
        };
      }
      return {
        tone: 'waiting',
        title: 'Waiting for customer approval',
        description: 'The quotation has been sent. Record the decision if the customer calls or visits.',
        href: `${base}/estimate`,
        label: 'View estimate',
      };
    default: {
      const forward = getManualForwardStatus(jobCard.status);
      const titles: Partial<Record<JobCardStatus, string>> = {
        APPROVED: 'Start the repair',
        IN_PROGRESS: 'Complete the repair',
        COMPLETED: 'Invoice the job',
        INVOICED: 'Close the job',
      };
      return {
        tone: 'action',
        title: titles[jobCard.status] ?? 'Continue',
        description:
          jobCard.status === 'APPROVED'
            ? 'The customer approved the work. Repair tracking arrives in the next phase.'
            : 'Repair, invoicing and delivery screens arrive in later phases.',
        manualStatus: forward ?? undefined,
        label: forward ? `Mark ${JOB_STATUS_LABEL[forward].toLowerCase()}` : undefined,
      };
    }
  }
}

/** Work queues for the Inspections / Estimates / Approvals screens. */
export async function getWorkQueues(user: AuthenticatedUser) {
  requirePermission(user, 'job_card.view');
  const org = user.organizationId;
  const jobSelect = {
    id: true,
    jobNumber: true,
    status: true,
    openedAt: true,
    customerComplaint: true,
    vehicle: {
      select: { plateNumber: true, make: true, model: true, customer: { select: { name: true, phone: true } } },
    },
    assignments: {
      where: { unassignedAt: null, assignmentRole: 'PRIMARY' as const },
      select: { employee: { select: { firstName: true, lastName: true } } },
    },
  };

  const [awaitingInspection, inInspection, awaitingDiagnosis, estimates] = await Promise.all([
    prisma.jobCard.findMany({ where: { organizationId: org, status: 'RECEIVED' }, orderBy: { openedAt: 'asc' }, select: jobSelect }),
    prisma.jobCard.findMany({
      where: { organizationId: org, status: 'INSPECTING', inspections: { some: { status: 'IN_PROGRESS' } } },
      orderBy: { openedAt: 'asc' },
      select: jobSelect,
    }),
    prisma.jobCard.findMany({
      where: { organizationId: org, status: 'INSPECTING', inspections: { none: { status: 'IN_PROGRESS' } } },
      orderBy: { openedAt: 'asc' },
      select: jobSelect,
    }),
    prisma.estimate.findMany({
      where: { organizationId: org, nextVersions: { none: {} } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        estimateNumber: true,
        version: true,
        status: true,
        totalAmount: true,
        validUntil: true,
        sentAt: true,
        updatedAt: true,
        approvals: { orderBy: { createdAt: 'desc' }, take: 1, select: { approvalMethod: true, createdAt: true } },
        jobCard: { select: jobSelect },
      },
    }),
  ]);

  const needsEstimate = await prisma.jobCard.findMany({
    where: { organizationId: org, status: 'DIAGNOSED', estimates: { none: {} } },
    orderBy: { openedAt: 'asc' },
    select: jobSelect,
  });

  return { awaitingInspection, inInspection, awaitingDiagnosis, needsEstimate, estimates };
}
