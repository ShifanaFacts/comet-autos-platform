import type { InventoryTransactionType, PurchaseStatus } from '@/generated/prisma/enums';

/*
 * Display labels shared by the inventory services and screens. Kept free of
 * database imports so client components can use them.
 */

export const MOVEMENT_LABEL: Record<InventoryTransactionType, string> = {
  OPENING_STOCK: 'Opening stock',
  PURCHASE_RECEIPT: 'Purchase received',
  JOB_CONSUMPTION: 'Used on job',
  JOB_RETURN: 'Returned from job',
  ADJUSTMENT: 'Adjustment',
  REVERSAL: 'Reversal',
  TRANSFER_IN: 'Transfer in',
  TRANSFER_OUT: 'Transfer out',
  RETURN_TO_SUPPLIER: 'Returned to supplier',
  CUSTOMER_RETURN: 'Customer return',
};

export const ADJUSTMENT_REASONS = {
  COUNT_CORRECTION: 'Stock count correction',
  DAMAGED: 'Damaged',
  LOST: 'Lost / missing',
  FOUND: 'Found in stock',
  WORKSHOP_USE: 'Workshop consumable use',
  OTHER: 'Other',
} as const;

export const PURCHASE_STATUS_LABEL: Record<PurchaseStatus, string> = {
  DRAFT: 'Draft',
  ORDERED: 'Ordered',
  PARTIALLY_RECEIVED: 'Partly received',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
  REVERSED: 'Reversed',
};
