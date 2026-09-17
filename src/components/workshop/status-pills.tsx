import type { AppointmentStatus, EstimateStatus, InspectionItemResult } from '@/generated/prisma/enums';
import { StatusPill, type PillTone } from '@/components/shared/status-pill';
import { APPOINTMENT_STATUS_LABEL, ESTIMATE_STATUS_LABEL } from '@/lib/workshop/labels';

const ESTIMATE_TONE: Record<EstimateStatus, PillTone> = {
  DRAFT: 'neutral',
  SENT: 'warning',
  APPROVED: 'success',
  PARTIALLY_APPROVED: 'success',
  REJECTED: 'danger',
  EXPIRED: 'neutral',
};

export function EstimateStatusPill({ status, expired }: { status: EstimateStatus; expired?: boolean }) {
  if (expired) return <StatusPill tone="danger">Expired</StatusPill>;
  return <StatusPill tone={ESTIMATE_TONE[status]}>{ESTIMATE_STATUS_LABEL[status]}</StatusPill>;
}

const APPOINTMENT_TONE: Record<AppointmentStatus, PillTone> = {
  SCHEDULED: 'neutral',
  CONFIRMED: 'info',
  CHECKED_IN: 'success',
  COMPLETED: 'success',
  CANCELLED: 'danger',
  NO_SHOW: 'warning',
};

export function AppointmentStatusPill({ status }: { status: AppointmentStatus }) {
  return <StatusPill tone={APPOINTMENT_TONE[status]}>{APPOINTMENT_STATUS_LABEL[status]}</StatusPill>;
}

const RESULT: Record<InspectionItemResult, { tone: PillTone; label: string }> = {
  OK: { tone: 'success', label: 'Pass' },
  ATTENTION_NEEDED: { tone: 'warning', label: 'Attention' },
  FAILED: { tone: 'danger', label: 'Fail' },
};

export function InspectionResultPill({ result }: { result: InspectionItemResult }) {
  return <StatusPill tone={RESULT[result].tone}>{RESULT[result].label}</StatusPill>;
}
