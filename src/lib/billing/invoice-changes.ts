import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { DomainError, NotFoundError } from '@/lib/errors';
import { parseInput } from '@/lib/form-data';
import { claimRequestKey, settleRequestKey } from '@/lib/request-keys';
import { filsToString, toFils } from '@/lib/money';
import { emptyToNull } from '@/lib/normalize';
import { resolveDefaultVatRate } from '@/lib/tax';
import {
  applyJobStatusChange,
  normalizeStatus,
  type WorkflowStatus,
} from '@/lib/workshop/job-status';
import { dueFils, paidFils, settlementStatus } from '@/lib/billing/invoice';
import { readDueDate } from '@/lib/billing/direct-invoice';
import { syncPosting } from '@/lib/accounting/journal';
import {
  assertIncomeAccounts,
  discountFields,
  lineData,
  lineSchema,
  priceDocument,
  totalsData,
} from '@/lib/billing/document-lines';
import { resolveTaxCodes } from '@/lib/accounting/tax-codes';

/*
 * Correcting billing after the fact. Three doors, each narrow on purpose:
 *
 *   updateInvoice          fix the lines of an invoice nobody has paid yet.
 *                          The number and issue date stay; the audit log
 *                          keeps the lines as they were.
 *   voidInvoice            withdraw an unpaid invoice altogether. It stays on
 *                          record as VOID with its number (never reused) and
 *                          the reason; its job card goes back to where it
 *                          was billed from, ready to be invoiced again.
 *   reverseInvoicePayment  undo a payment recorded in error. The payment is
 *                          never edited or deleted — a reversal row cancels
 *                          it (the Payment model's rule) — and the invoice
 *                          and job card step back to match.
 *
 * Money already received is never silently rewritten: an invoice with a
 * payment on it must have that payment reversed before it can change.
 */

const REASON = z
  .string({ error: 'Say why.' })
  .trim()
  .min(3, 'Say why, in a few words.')
  .max(500, 'Keep the reason under 500 characters.');

/** Locks the invoice's job card (always before the invoice), then the invoice. */
async function lockInvoice(
  tx: Prisma.TransactionClient,
  organizationId: string,
  invoiceId: string,
) {
  const target = await tx.invoice.findFirst({
    where: { id: invoiceId, organizationId },
    select: { id: true, jobCardId: true },
  });
  if (!target) throw new NotFoundError('invoice');
  if (target.jobCardId) {
    await tx.$executeRaw`SELECT id FROM job_cards WHERE id = ${target.jobCardId}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`;
  }
  await tx.$executeRaw`SELECT id FROM invoices WHERE id = ${target.id}::uuid FOR UPDATE`;
  const invoice = await tx.invoice.findFirstOrThrow({
    where: { id: target.id, organizationId },
    include: {
      items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      payments: { select: { id: true, amount: true, status: true, reversalOfPaymentId: true } },
      jobCard: { select: { id: true, status: true, jobNumber: true } },
    },
  });
  return invoice;
}

function lineSnapshot(
  items: {
    itemType: string | null;
    description: string;
    quantity: { toString(): string };
    unitPrice: { toString(): string };
    taxRate: { toString(): string } | null;
    discountAmount: { toString(): string };
    lineTotal: { toString(): string };
  }[],
) {
  return items.map((item) => ({
    itemType: item.itemType,
    description: item.description,
    quantity: item.quantity.toString(),
    unitPrice: item.unitPrice.toString(),
    taxRate: item.taxRate?.toString() ?? '0',
    discountAmount: item.discountAmount.toString(),
    lineTotal: item.lineTotal.toString(),
  }));
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

const updateSchema = z.object({
  items: z
    .array(lineSchema)
    .min(1, 'An invoice needs at least one line.')
    .max(100, 'An invoice can have at most 100 lines.'),
  ...discountFields,
  dueDate: z.string().trim().optional(),
  customerReference: z
    .string()
    .trim()
    .max(60, "Keep the customer's order number under 60 characters.")
    .optional(),
  notes: z.string().trim().max(1000, 'Keep the notes under 1000 characters.').optional(),
  requestKey: z.string().optional(),
});

const CREDITED =
  'A credit note has been issued against this invoice, so it stands as issued. Correct it with a credit note instead.';

const isCredited = (invoice: { creditedAmount?: { toString(): string } }) =>
  invoice.creditedAmount !== undefined && toFils(invoice.creditedAmount.toString()) > 0;

/** Settled in part from a customer advance (lib/billing/advances.ts). */
const hasAdvanceApplied = (invoice: { advanceAppliedAmount?: { toString(): string } }) =>
  invoice.advanceAppliedAmount !== undefined && toFils(invoice.advanceAppliedAmount.toString()) > 0;

const ADVANCE_APPLIED = (to: string) =>
  `A customer advance has been applied to this invoice. Undo it on the invoice first to ${to}.`;

/** Why an invoice can't be edited, or null when it can. Shared with the screens. */
export function invoiceEditBlocker(invoice: {
  status: string;
  invoiceType?: string;
  paidAmount?: string;
  creditedAmount?: { toString(): string };
  advanceAppliedAmount?: { toString(): string };
  items: { labourId: string | null; partUsageId: string | null }[];
}): string | null {
  if (invoice.status === 'VOID' || invoice.status === 'CANCELLED') return 'This invoice is void.';
  if (invoice.invoiceType === 'OPENING_BALANCE') {
    return 'An opening balance is changed on the Opening balances screen.';
  }
  if (isCredited(invoice)) return CREDITED;
  if (hasAdvanceApplied(invoice)) return ADVANCE_APPLIED('change the invoice');
  if (
    invoice.status !== 'ISSUED' ||
    (invoice.paidAmount !== undefined && toFils(invoice.paidAmount) > 0)
  ) {
    return 'A payment has been recorded. Reverse the payment first to change the invoice.';
  }
  if (invoice.items.some((item) => item.labourId || item.partUsageId)) {
    return 'This invoice was billed from the repair records. Void it and invoice the job again instead.';
  }
  return null;
}

/**
 * Replaces the lines, discounts, due date, order number and notes of an
 * unpaid invoice. Priced by the same rules as a new one; the number, issue
 * date, customer and vehicle don't change, but the seller and customer
 * details are refreshed to the current ones.
 */
export async function updateInvoice(user: AuthenticatedUser, invoiceId: string, rawInput: unknown) {
  const input = parseInput(updateSchema, rawInput);
  const defaultVatRate = await resolveDefaultVatRate(user.organizationId);

  return prisma.$transaction(async (tx) => {
    await claimRequestKey(tx, user, rawInput, 'invoice.update');
    const invoice = await lockInvoice(tx, user.organizationId, invoiceId);
    requirePermission(user, 'invoice.edit', { branchId: invoice.branchId });
    const blocker = invoiceEditBlocker({
      status: invoice.status,
      invoiceType: invoice.invoiceType,
      paidAmount: filsToString(paidFils(invoice.payments)),
      creditedAmount: invoice.creditedAmount,
      advanceAppliedAmount: invoice.advanceAppliedAmount,
      items: invoice.items,
    });
    if (blocker) throw new DomainError(blocker);

    const { lines, totals } = priceDocument(
      input.items,
      defaultVatRate,
      input,
      await resolveTaxCodes(tx, user.organizationId, input.items),
    );
    await assertIncomeAccounts(tx, user.organizationId, lines);
    const dueDate = readDueDate(input.dueDate, invoice.issueDate);

    await tx.invoiceItem.deleteMany({
      where: { organizationId: user.organizationId, invoiceId: invoice.id },
    });
    for (const line of lines) {
      await tx.invoiceItem.create({
        data: {
          organizationId: user.organizationId,
          invoiceId: invoice.id,
          itemType: line.itemType,
          description: line.description,
          accountId: line.accountId ?? null,
          vatTreatment: line.vatTreatment,
          taxCodeId: line.taxCodeId ?? null,
          ...lineData(line.amounts),
        },
      });
    }
    // A corrected invoice is re-issued under the same number, so it carries
    // the workshop's and customer's details as they are now — not whatever
    // was on file when the first draft went out.
    const [organization, customer] = await Promise.all([
      tx.organization.findUniqueOrThrow({
        where: { id: user.organizationId },
        select: { name: true, legalName: true, taxNumber: true, address: true },
      }),
      tx.customer.findFirstOrThrow({
        where: { id: invoice.customerId, organizationId: user.organizationId },
        select: { name: true, taxNumber: true, address: true },
      }),
    ]);
    const parties = {
      sellerLegalName: organization.legalName ?? organization.name,
      sellerTaxNumber: organization.taxNumber,
      sellerAddress: organization.address,
      customerName: customer.name,
      customerTaxNumber: customer.taxNumber,
      customerAddress: customer.address,
    };

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        ...totalsData(totals),
        dueDate,
        customerReference: emptyToNull(input.customerReference),
        notes: emptyToNull(input.notes),
        ...parties,
      },
    });
    // The corrected figures replace the old ones in the books: the old entry
    // is reversed and the new one booked, on the invoice's own date.
    await syncPosting(tx, user.organizationId, 'INVOICE', invoice.id, user.id);

    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: invoice.branchId,
      actorUserId: user.id,
      action: 'invoice.updated',
      entityType: 'Invoice',
      entityId: invoice.id,
      beforeData: {
        lines: lineSnapshot(invoice.items),
        discountAmount: invoice.discountAmount.toString(),
        subtotal: invoice.subtotal.toString(),
        taxAmount: invoice.taxAmount.toString(),
        totalAmount: invoice.totalAmount.toString(),
        dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
        customerReference: invoice.customerReference,
        notes: invoice.notes,
        sellerLegalName: invoice.sellerLegalName,
        sellerTaxNumber: invoice.sellerTaxNumber,
        sellerAddress: invoice.sellerAddress,
        customerName: invoice.customerName,
        customerTaxNumber: invoice.customerTaxNumber,
        customerAddress: invoice.customerAddress,
      },
      afterData: {
        lines: lines.map((line) => ({
          itemType: line.itemType,
          description: line.description,
          quantity: line.amounts.quantity,
          unitPrice: line.amounts.unitPrice,
          taxRate: line.amounts.taxRate,
          discountAmount: line.amounts.discountAmount,
          lineTotal: line.amounts.lineTotal,
        })),
        discountAmount: totals.discountAmount,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        dueDate: dueDate.toISOString().slice(0, 10),
        customerReference: emptyToNull(input.customerReference),
        notes: emptyToNull(input.notes),
        ...parties,
      },
      metadata: { invoiceNumber: invoice.invoiceNumber },
    });
    await settleRequestKey(tx, user, rawInput, invoice.id);
    return { invoiceId: invoice.id };
  });
}

// ---------------------------------------------------------------------------
// Void
// ---------------------------------------------------------------------------

const voidSchema = z.object({ reason: REASON, requestKey: z.string().optional() });

/** Why an invoice can't be voided, or null when it can. Shared with the screens. */
export function invoiceVoidBlocker(invoice: {
  status: string;
  paidAmount?: string;
  creditedAmount?: { toString(): string };
  advanceAppliedAmount?: { toString(): string };
  jobCard: { status: string } | null;
}): string | null {
  if (invoice.status === 'VOID' || invoice.status === 'CANCELLED')
    return 'This invoice is already void.';
  if (isCredited(invoice)) return CREDITED;
  if (hasAdvanceApplied(invoice)) return ADVANCE_APPLIED('void the invoice');
  if (
    invoice.status !== 'ISSUED' ||
    (invoice.paidAmount !== undefined && toFils(invoice.paidAmount) > 0)
  ) {
    return 'A payment has been recorded. Reverse the payment first to void the invoice.';
  }
  if (invoice.jobCard?.status === 'DELIVERED') {
    return 'The vehicle was already handed back on this invoice. Edit the invoice instead.';
  }
  return null;
}

/**
 * Voids an unpaid invoice. Its job card goes back to the stage it was
 * billed from, so it can be invoiced again.
 */
export async function voidInvoice(user: AuthenticatedUser, invoiceId: string, rawInput: unknown) {
  const input = parseInput(voidSchema, rawInput);

  return prisma.$transaction(async (tx) => {
    await claimRequestKey(tx, user, rawInput, 'invoice.void');
    const invoice = await lockInvoice(tx, user.organizationId, invoiceId);
    requirePermission(user, 'invoice.delete', { branchId: invoice.branchId });
    const blocker = invoiceVoidBlocker({
      status: invoice.status,
      paidAmount: filsToString(paidFils(invoice.payments)),
      creditedAmount: invoice.creditedAmount,
      advanceAppliedAmount: invoice.advanceAppliedAmount,
      jobCard: invoice.jobCard,
    });
    if (blocker) throw new DomainError(blocker);

    const voidedAt = new Date();
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: 'VOID', voidedAt, voidReason: input.reason },
    });
    // A void invoice was never a sale: its entry is reversed.
    await syncPosting(tx, user.organizationId, 'INVOICE', invoice.id, user.id);

    let reopenedTo: WorkflowStatus | null = null;
    if (invoice.jobCard && normalizeStatus(invoice.jobCard.status) === 'INVOICED') {
      // Back to where it was billed from: the stage before its latest move to INVOICED.
      const billed = await tx.jobStatusHistory.findFirst({
        where: {
          organizationId: user.organizationId,
          jobCardId: invoice.jobCard.id,
          toStatus: 'INVOICED',
        },
        orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
        select: { fromStatus: true },
      });
      const previous = billed?.fromStatus ? normalizeStatus(billed.fromStatus) : 'ARRIVED';
      reopenedTo = ['ON_HOLD', 'CANCELLED', 'REJECTED', 'INVOICED', 'PAID', 'DELIVERED'].includes(
        previous,
      )
        ? 'ARRIVED'
        : previous;
      await applyJobStatusChange(tx, {
        organizationId: user.organizationId,
        jobCardId: invoice.jobCard.id,
        toStatus: reopenedTo,
        actor: { userId: user.id },
        source: 'workflow',
        reopen: true,
        metadata: { invoiceId: invoice.id, reason: 'invoice_voided' },
      });
    }

    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: invoice.branchId,
      actorUserId: user.id,
      action: 'invoice.voided',
      entityType: 'Invoice',
      entityId: invoice.id,
      beforeData: { status: invoice.status },
      afterData: { status: 'VOID', voidedAt: voidedAt.toISOString(), reason: input.reason },
      metadata: {
        invoiceNumber: invoice.invoiceNumber,
        totalAmount: invoice.totalAmount.toString(),
        jobCardId: invoice.jobCard?.id ?? null,
        jobReopenedTo: reopenedTo,
      },
    });
    await settleRequestKey(tx, user, rawInput, invoice.id);
    return { invoiceId: invoice.id, jobCardId: invoice.jobCard?.id ?? null };
  });
}

// ---------------------------------------------------------------------------
// Reverse a payment
// ---------------------------------------------------------------------------

const reversalSchema = z.object({ reason: REASON, requestKey: z.string().optional() });

/**
 * Cancels a customer payment recorded in error with a reversal row. The
 * invoice's balance reopens by that amount; a paid job card that was not
 * yet handed back returns to Invoiced.
 */
export async function reverseInvoicePayment(
  user: AuthenticatedUser,
  paymentId: string,
  rawInput: unknown,
) {
  const input = parseInput(reversalSchema, rawInput);

  return prisma.$transaction(async (tx) => {
    await claimRequestKey(tx, user, rawInput, 'payment.reversal');
    const found = await tx.payment.findFirst({
      where: { id: paymentId, organizationId: user.organizationId },
      select: { id: true, invoiceId: true },
    });
    if (!found) throw new NotFoundError('payment');
    const invoice = await lockInvoice(tx, user.organizationId, found.invoiceId);
    requirePermission(user, 'payment.delete', { branchId: invoice.branchId });

    const payment = await tx.payment.findFirstOrThrow({
      where: { id: found.id, organizationId: user.organizationId },
      include: { reversals: { select: { id: true } } },
    });
    if (payment.reversalOfPaymentId) throw new DomainError('That row is itself a reversal.');
    if (payment.status !== 'COMPLETED' || payment.reversals.length > 0) {
      throw new DomainError('This payment has already been reversed.');
    }
    if (invoice.status === 'VOID' || invoice.status === 'CANCELLED') {
      throw new DomainError('This invoice is void.');
    }
    // Money owed back under a credit note was worked out from what was paid.
    const refunding = await tx.creditNote.findFirst({
      where: {
        organizationId: user.organizationId,
        invoiceId: invoice.id,
        status: 'ISSUED',
        refundAmount: { gt: 0 },
      },
      select: { creditNoteNumber: true, refundedOn: true },
    });
    if (refunding) {
      throw new DomainError(
        refunding.refundedOn
          ? `Money was refunded to the customer under credit note ${refunding.creditNoteNumber}, so the payments on this invoice stand.`
          : `Credit note ${refunding.creditNoteNumber} owes the customer a refund out of this payment. Void the credit note first.`,
      );
    }

    const reversal = await tx.payment.create({
      data: {
        organizationId: user.organizationId,
        invoiceId: invoice.id,
        // Same positive amount; a reversal is identified by its link, not a sign.
        amount: payment.amount.toString(),
        method: payment.method,
        status: 'REVERSED',
        referenceNumber: `Reversal of ${payment.paymentNumber ?? payment.id}`,
        notes: input.reason,
        reversalOfPaymentId: payment.id,
        receivedAt: new Date(),
        receivedByUserId: user.id,
      },
      select: { id: true },
    });
    // The reversal is booked as its own entry, the original's opposite.
    await syncPosting(tx, user.organizationId, 'PAYMENT', reversal.id, user.id);

    const payments = [
      ...invoice.payments,
      {
        id: reversal.id,
        amount: payment.amount,
        status: 'REVERSED',
        reversalOfPaymentId: payment.id,
      },
    ];
    const paid = paidFils(payments);
    const status = settlementStatus(invoice, paid);
    await tx.invoice.update({ where: { id: invoice.id }, data: { status } });

    let jobReopened = false;
    if (
      invoice.jobCard &&
      status !== 'PAID' &&
      normalizeStatus(invoice.jobCard.status) === 'PAID'
    ) {
      await applyJobStatusChange(tx, {
        organizationId: user.organizationId,
        jobCardId: invoice.jobCard.id,
        toStatus: 'INVOICED',
        actor: { userId: user.id },
        source: 'workflow',
        reopen: true,
        metadata: { invoiceId: invoice.id, paymentId: payment.id, reason: 'payment_reversed' },
      });
      jobReopened = true;
    }

    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: invoice.branchId,
      actorUserId: user.id,
      action: 'payment.reversed',
      entityType: 'Payment',
      entityId: payment.id,
      beforeData: { invoiceStatus: invoice.status },
      afterData: {
        reversalId: reversal.id,
        invoiceStatus: status,
        balanceAfter: filsToString(dueFils(invoice, paid)),
        reason: input.reason,
      },
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        paymentNumber: payment.paymentNumber,
        amount: payment.amount.toString(),
        jobReopened,
      },
    });
    await settleRequestKey(tx, user, rawInput, reversal.id);
    return { invoiceId: invoice.id, jobCardId: invoice.jobCard?.id ?? null };
  });
}
