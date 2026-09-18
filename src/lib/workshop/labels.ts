import type { AppointmentStatus, EstimateStatus } from '@/generated/prisma/enums';

// Pure label maps, safe to import from Client Components.

export const ESTIMATE_STATUS_LABEL: Record<EstimateStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Waiting approval',
  APPROVED: 'Approved',
  PARTIALLY_APPROVED: 'Partially approved',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
};

export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  SCHEDULED: 'Scheduled',
  CONFIRMED: 'Confirmed',
  CHECKED_IN: 'Checked in',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
};
