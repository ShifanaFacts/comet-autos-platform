import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { DomainError } from '@/lib/errors';
import { parseInput } from '@/lib/form-data';
import { formatCalendarDate, parseCalendarDate } from '@/lib/format';

/*
 * Closing the books.
 *
 * Once a period is reported — a VAT return filed, a year's accounts signed
 * off — its figures must not move. The accountant closes the books through a
 * date; from then on nothing dated on or before it can be booked, changed or
 * voided, whichever screen it is tried from: every posting checks here
 * (lib/accounting/journal.ts), inside the same transaction as the change,
 * so the change itself is refused.
 *
 * Reopening is possible — it is sometimes needed — but it is a deliberate,
 * audited act with a reason.
 */

/** The date the books are closed through, or null when every period is open. */
export async function booksClosedThrough(
  client: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
): Promise<Date | null> {
  const organization = await client.organization.findUnique({
    where: { id: organizationId },
    select: { booksClosedThrough: true },
  });
  return organization?.booksClosedThrough ?? null;
}

/** Refuses anything dated inside a closed period. */
export async function assertBooksOpen(
  tx: Prisma.TransactionClient,
  organizationId: string,
  date: Date,
) {
  const closed = await booksClosedThrough(tx, organizationId);
  if (closed && date.getTime() <= closed.getTime()) {
    throw new DomainError(
      `The books are closed through ${formatCalendarDate(closed)}, so nothing dated ${formatCalendarDate(date)} can be booked or changed. Ask your accountant to reopen that period first.`,
    );
  }
}

const closeSchema = z.object({
  through: z
    .string({ error: 'Choose the last date to close.' })
    .min(1, 'Choose the last date to close.'),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Closes the books through a date, or moves the close earlier (reopening
 * what follows). Moving it earlier needs a reason, kept in the audit log.
 */
export async function closeBooks(user: AuthenticatedUser, rawInput: unknown) {
  requirePermission(user, 'accounting.edit');
  const input = parseInput(closeSchema, rawInput);
  const through = parseCalendarDate(input.through);
  if (!through) throw new DomainError('Choose a valid date.', 'through');
  if (through.getTime() > Date.now()) {
    throw new DomainError('The books can only be closed up to today.', 'through');
  }

  return prisma.$transaction(async (tx) => {
    const before = await booksClosedThrough(tx, user.organizationId);
    const reopening = before !== null && through.getTime() < before.getTime();
    if (reopening && !input.reason) {
      throw new DomainError('Say why the period is being reopened.', 'reason');
    }
    await tx.organization.update({
      where: { id: user.organizationId },
      data: { booksClosedThrough: through },
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: reopening ? 'books.reopened' : 'books.closed',
      entityType: 'Organization',
      entityId: user.organizationId,
      beforeData: { booksClosedThrough: before?.toISOString().slice(0, 10) ?? null },
      afterData: { booksClosedThrough: input.through },
      metadata: input.reason ? { reason: input.reason } : undefined,
    });
    return { through };
  });
}

/** Opens every period again. Needs a reason, kept in the audit log. */
export async function reopenAllBooks(user: AuthenticatedUser, rawInput: unknown) {
  requirePermission(user, 'accounting.edit');
  const { reason } = parseInput(
    z.object({
      reason: z.string().trim().min(3, 'Say why the books are being reopened.').max(500),
    }),
    rawInput,
  );
  return prisma.$transaction(async (tx) => {
    const before = await booksClosedThrough(tx, user.organizationId);
    await tx.organization.update({
      where: { id: user.organizationId },
      data: { booksClosedThrough: null },
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: 'books.reopened',
      entityType: 'Organization',
      entityId: user.organizationId,
      beforeData: { booksClosedThrough: before?.toISOString().slice(0, 10) ?? null },
      afterData: { booksClosedThrough: null },
      metadata: { reason },
    });
  });
}
