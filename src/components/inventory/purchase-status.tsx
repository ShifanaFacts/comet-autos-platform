import type { PurchaseStatus } from '@/generated/prisma/enums';
import { StatusPill, type PillTone } from '@/components/shared/status-pill';
import { PURCHASE_STATUS_LABEL } from '@/lib/inventory/labels';

const TONE: Record<PurchaseStatus, PillTone> = {
  DRAFT: 'info',
  ORDERED: 'info',
  PARTIALLY_RECEIVED: 'warning',
  RECEIVED: 'success',
  CANCELLED: 'neutral',
  REVERSED: 'neutral',
};

export function PurchaseStatusPill({ status }: { status: PurchaseStatus }) {
  return <StatusPill tone={TONE[status]}>{PURCHASE_STATUS_LABEL[status]}</StatusPill>;
}
