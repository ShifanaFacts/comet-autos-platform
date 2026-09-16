import type { Prisma } from '@/generated/prisma/client';

export interface AuditLogEntry {
  organizationId: string;
  branchId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  beforeData?: unknown;
  afterData?: unknown;
  metadata?: unknown;
}

// Only state-changing actions are audited (section 26 of the V1 build
// instruction) — never page reads. Always called inside the same
// transaction as the change it records, so the two can never disagree.
export async function writeAuditLog(
  tx: Prisma.TransactionClient,
  entry: AuditLogEntry,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      organizationId: entry.organizationId,
      branchId: entry.branchId ?? null,
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      beforeData: entry.beforeData as Prisma.InputJsonValue,
      afterData: entry.afterData as Prisma.InputJsonValue,
      metadata: entry.metadata as Prisma.InputJsonValue,
    },
  });
}
