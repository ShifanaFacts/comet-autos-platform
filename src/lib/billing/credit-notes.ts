import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { DomainError, NotFoundError } from '@/lib/errors';
import { parseInput } from '@/lib/form-data';
import { claimRequestKey, settleRequestKey } from '@/lib/request-keys';
import { filsToString, shareFils, toFils } from '@/lib/money';
import { localDateString, parseCalendarDate } from '@/lib/format';
import { allocateDocumentNumber } from '@/lib/numbering';
import { paidFils, settlementStatus } from '@/lib/billing/invoice';
import { syncPosting } from '@/lib/accounting/journal';
import { checkMoneyAccount } from '@/lib/accounting/chart';
import { emptyToNull } from '@/lib/normalize';
import { returnToAdvances, undoReturnsToAdvances } from '@/lib/billing/advances';

/*
 * Tax credit notes — the only way an issued tax invoice is reduced once it
 * has been paid, or once its VAT period may have been reported. The invoice
 * itself is never changed: the credit note is a document of its own, with
 * its own number (CN-), date and reason, that takes part or all of the
 * invoice back.
 *
 *   The invoice          stays exactly as issued; its `creditedAmount` grows
 *                        by the note's total, so what is due becomes
 *                        total − credited − paid − advance applied
 *                        (lib/billing/invoice.ts).
 *   VAT                  the note reduces the supplies and output VAT of the
 *                        period it is issued in (lib/finance/vat.ts).
 *   The books            Dr income and VAT, Cr trade receivables — the
 *                        invoice's own entry, in part, undone
 *                        (lib/accounting/postings.ts).
 *   Money already paid   beyond what is now due is owed back to the customer.
 *                        What was settled from customer advances goes back
 *                        to those advances first (lib/billing/advances.ts);
 *                        only the rest is a cash refund, which the note
 *                        records when it is paid out.
 *
 * Each note credits invoice lines by amount (before VAT). A line can never
 * be credited beyond what it was sold for, across all notes; a line credited
 * in full comes back to the fil — its own VAT and its share of any bill
 * discount exactly — so crediting a whole invoice mirrors it exactly.
 *
 * A note is voided, never deleted, and only while no refund has been paid
 * under it.
 */

const REASON = z
  .string({ error: 'Say why the invoice is being credited.' })
  .trim()
  .min(3, 'Say why the invoice is being credited, in a few words.')
  .max(500, 'Keep the reason under 500 characters.');

const AMOUNT = /^\d+(\.\d{1,2})?$/;

const creditSchema = z.object({
  issueDate: z.string().trim().optional(),
  reason: REASON,
  lines: z
    .array(
      z.object({
        invoiceItemId: z.uuid(),
        /** Before VAT, after the line's share of any bill discount. Blank or 0 skips it. */
        amount: z
          .string()
          .trim()
          .refine((value) => !value || AMOUNT.test(value), 'Enter an amount like 250 or 250.50.'),
        /** For the document only: how many of the line's units come back. */
        quantity: z.string().trim().optional(),
      }),
    )
    .max(100),
  requestKey: z.string().optional(),
});

const fils = (value: { toString(): string } | null | undefined) =>
  value ? toFils(value.toString()) : 0;

const milli = (value: { toString(): string }) => Math.round(Number(value.toString()) * 1000);

/** Half-up rounding of a non-negative integer ratio. */
const divRound = (numerator: bigint, denominator: bigint) =>
  Number((numerator * BigInt(2) + denominator) / (denominator * BigInt(2)));

type Tx = Prisma.TransactionClient;

interface InvoiceLine {
  id: string;
  itemType: Prisma.InvoiceItemGetPayload<object>['itemType'];
  description: string;
  quantity: { toString(): string };
  unitPrice: { toString(): string };
  lineTotal: { toString(): string };
  taxRate: { toString(): string } | null;
  taxAmount: { toString(): string } | null;
  vatTreatment: Prisma.InvoiceItemGetPayload<object>['vatTreatment'];
  accountId: string | null;
}

interface CreditedSoFar {
  gross: number;
  share: number;
  tax: number;
}

/**
 * What is left to credit on each line of an invoice: its value after its
 * share of the bill discount, less every issued credit note against it.
 */
function creditableLines(
  invoice: { discountAmount: { toString(): string }; items: InvoiceLine[] },
  credited: Map<string, CreditedSoFar>,
) {
  const shares = shareFils(
    fils(invoice.discountAmount),
    invoice.items.map((item) => fils(item.lineTotal)),
  );
  return invoice.items.map((item, index) => {
    const gross = fils(item.lineTotal);
    const share = shares[index];
    const tax = fils(item.taxAmount);
    const before = credited.get(item.id) ?? { gross: 0, share: 0, tax: 0 };
    return {
      item,
      gross,
      share,
      tax,
      before,
      /** Net of the bill discount, before VAT. */
      net: gross - share,
      remaining: gross - share - (before.gross - before.share),
      remainingTax: tax - before.tax,
    };
  });
}

type Creditable = ReturnType<typeof creditableLines>[number];

/** The part of a line a credit of `amount` fils (before VAT) takes back. */
function creditPart(line: Creditable, amount: number) {
  if (amount === line.remaining) {
    // The rest of the line: exactly what is left, so nothing is ever off by a fil.
    return {
      gross: line.gross - line.before.gross,
      share: line.share - line.before.share,
      tax: line.remainingTax,
    };
  }
  let gross = line.net > 0 ? divRound(BigInt(amount) * BigInt(line.gross), BigInt(line.net)) : 0;
  gross = Math.min(Math.max(gross, amount), line.gross - line.before.gross);
  let share = gross - amount;
  if (share > line.share - line.before.share) {
    share = line.share - line.before.share;
    gross = amount + share;
  }
  const rateHundredths = Math.round(Number((line.item.taxRate ?? 0).toString()) * 100);
  const tax = Math.min(
    divRound(BigInt(amount) * BigInt(rateHundredths), BigInt(10000)),
    line.remainingTax,
  );
  return { gross, share, tax };
}

async function creditedSoFar(tx: Tx | typeof prisma, organizationId: string, invoiceId: string) {
  const rows = await tx.creditNoteItem.findMany({
    where: {
      organizationId,
      invoiceItemId: { not: null },
      creditNote: { invoiceId, status: 'ISSUED' },
    },
    select: { invoiceItemId: true, lineTotal: true, discountAmount: true, taxAmount: true },
  });
  const byLine = new Map<string, CreditedSoFar>();
  for (const row of rows) {
    const entry = byLine.get(row.invoiceItemId!) ?? { gross: 0, share: 0, tax: 0 };
    entry.gross += fils(row.lineTotal);
    entry.share += fils(row.discountAmount);
    entry.tax += fils(row.taxAmount);
    byLine.set(row.invoiceItemId!, entry);
  }
  return byLine;
}

const INVOICE_LINES = {
  orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
  select: {
    id: true,
    itemType: true,
    description: true,
    quantity: true,
    unitPrice: true,
    lineTotal: true,
    taxRate: true,
    taxAmount: true,
    vatTreatment: true,
    accountId: true,
  },
};

/** Why an invoice can't be credited, or null when it can. Shared with the screens. */
export function creditBlocker(invoice: {
  invoiceType: string;
  status: string;
  totalAmount: { toString(): string };
  creditedAmount: { toString(): string };
}): string | null {
  if (invoice.invoiceType !== 'TAX_INVOICE') {
    return 'A pro-forma invoice is not a supply. Edit or void it instead.';
  }
  if (invoice.status === 'VOID' || invoice.status === 'CANCELLED') return 'This invoice is void.';
  if (invoice.status === 'DRAFT') return 'A draft invoice has not been issued. Edit it instead.';
  if (fils(invoice.creditedAmount) >= fils(invoice.totalAmount)) {
    return 'This invoice has been credited in full.';
  }
  return null;
}

/** The credit note screen: each invoice line with what is left to credit on it. */
export async function getCreditableInvoice(user: AuthenticatedUser, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId: user.organizationId },
    select: {
      id: true,
      branchId: true,
      invoiceNumber: true,
      invoiceType: true,
      status: true,
      issueDate: true,
      customerName: true,
      discountAmount: true,
      subtotal: true,
      taxAmount: true,
      totalAmount: true,
      creditedAmount: true,
      advanceAppliedAmount: true,
      jobCardId: true,
      customer: { select: { name: true } },
      items: INVOICE_LINES,
      payments: { select: { id: true, amount: true, status: true, reversalOfPaymentId: true } },
    },
  });
  if (!invoice) throw new NotFoundError('invoice');
  requirePermission(user, 'credit_note.create', { branchId: invoice.branchId });
  const credited = await creditedSoFar(prisma, user.organizationId, invoice.id);
  const lines = creditableLines(invoice, credited).map((line) => ({
    id: line.item.id,
    itemType: line.item.itemType,
    description: line.item.description,
    quantity: line.item.quantity.toString(),
    vatTreatment: line.item.vatTreatment,
    taxRate: (line.item.taxRate ?? 0).toString(),
    /** After its share of the bill discount, before VAT. */
    net: filsToString(line.net),
    remaining: filsToString(line.remaining),
    remainingTax: filsToString(line.remainingTax),
  }));
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    issueDate: invoice.issueDate,
    customerName: invoice.customerName ?? invoice.customer.name,
    jobCardId: invoice.jobCardId,
    totalAmount: invoice.totalAmount.toString(),
    creditedAmount: invoice.creditedAmount.toString(),
    paid: filsToString(paidFils(invoice.payments)),
    advanceApplied: invoice.advanceAppliedAmount.toString(),
    blocker: creditBlocker(invoice),
    lines,
  };
}

/**
 * Issues a tax credit note against an invoice. Returns the note, with the
 * refund now owed to the customer (the money paid beyond what is due).
 */
export async function createCreditNote(
  user: AuthenticatedUser,
  invoiceId: string,
  rawInput: unknown,
) {
  const input = parseInput(creditSchema, rawInput);
  const issueDay = input.issueDate || localDateString();
  const issueDate = parseCalendarDate(issueDay);
  if (!issueDate) throw new DomainError('Enter the credit note date.', 'issueDate');
  if (issueDay > localDateString()) {
    throw new DomainError('A credit note cannot be dated in the future.', 'issueDate');
  }

  return prisma.$transaction(async (tx) => {
    await claimRequestKey(tx, user, rawInput, 'credit_note.create');
    await tx.$executeRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid AND organization_id = ${user.organizationId}::uuid FOR UPDATE`;
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, organizationId: user.organizationId },
      select: {
        id: true,
        branchId: true,
        customerId: true,
        invoiceNumber: true,
        invoiceType: true,
        status: true,
        issueDate: true,
        discountAmount: true,
        totalAmount: true,
        creditedAmount: true,
        advanceAppliedAmount: true,
        items: INVOICE_LINES,
        payments: { select: { id: true, amount: true, status: true, reversalOfPaymentId: true } },
      },
    });
    if (!invoice) throw new NotFoundError('invoice');
    requirePermission(user, 'credit_note.create', { branchId: invoice.branchId });
    const blocker = creditBlocker(invoice);
    if (blocker) throw new DomainError(blocker);
    if (issueDate < invoice.issueDate) {
      throw new DomainError('A credit note cannot be dated before its invoice.', 'issueDate');
    }

    const lines = creditableLines(
      invoice,
      await creditedSoFar(tx, user.organizationId, invoice.id),
    );
    const items: Prisma.CreditNoteItemCreateManyInput[] = [];
    let grossTotal = 0;
    let shareTotal = 0;
    let taxTotal = 0;
    input.lines.forEach((entry, index) => {
      const amount = entry.amount ? toFils(entry.amount) : 0;
      if (amount === 0) return;
      const line = lines.find((candidate) => candidate.item.id === entry.invoiceItemId);
      if (!line) throw new DomainError('That line is not on this invoice.', `lines.${index}`);
      if (amount > line.remaining) {
        throw new DomainError(
          `"${line.item.description}": only ${filsToString(line.remaining)} is left to credit.`,
          `lines.${index}.amount`,
        );
      }
      const part = creditPart(line, amount);
      const whole = part.gross === line.gross;
      const quantityMilli = whole
        ? milli(line.item.quantity)
        : entry.quantity && Number(entry.quantity) > 0
          ? Math.min(Math.round(Number(entry.quantity) * 1000), milli(line.item.quantity))
          : 1000;
      grossTotal += part.gross;
      shareTotal += part.share;
      taxTotal += part.tax;
      items.push({
        organizationId: user.organizationId,
        creditNoteId: '',
        invoiceItemId: line.item.id,
        itemType: line.item.itemType,
        description: line.item.description,
        quantity: (quantityMilli / 1000).toFixed(3),
        unitPrice: whole
          ? line.item.unitPrice.toString()
          : filsToString(divRound(BigInt(part.gross) * BigInt(1000), BigInt(quantityMilli))),
        lineTotal: filsToString(part.gross),
        discountAmount: filsToString(part.share),
        vatTreatment: line.item.vatTreatment,
        taxRate: (line.item.taxRate ?? 0).toString(),
        taxAmount: filsToString(part.tax),
        accountId: line.item.accountId,
      });
    });
    if (items.length === 0) {
      throw new DomainError('Enter the amount to credit on at least one line.', 'lines');
    }

    const subtotal = grossTotal - shareTotal;
    const total = subtotal + taxTotal;
    const creditedBefore = fils(invoice.creditedAmount);
    const invoiceTotal = fils(invoice.totalAmount);
    if (creditedBefore + total > invoiceTotal) {
      throw new DomainError('That would credit more than the invoice was for.');
    }
    const paid = paidFils(invoice.payments);
    const appliedBefore = fils(invoice.advanceAppliedAmount);
    // What was settled beyond what is now due goes back to the customer: to
    // their advances first, as far as advances settled it, and the rest as a
    // cash refund.
    const excess = Math.min(
      Math.max(paid + appliedBefore - (invoiceTotal - creditedBefore - total), 0),
      total,
    );
    const toAdvances = Math.min(excess, appliedBefore);
    const refund = excess - toAdvances;

    const creditNoteNumber = await allocateDocumentNumber(
      tx,
      user.organizationId,
      invoice.branchId,
      'CREDIT_NOTE',
    );
    const note = await tx.creditNote.create({
      data: {
        organizationId: user.organizationId,
        branchId: invoice.branchId,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        creditNoteNumber,
        issueDate,
        reason: input.reason,
        discountAmount: filsToString(shareTotal),
        subtotal: filsToString(subtotal),
        taxAmount: filsToString(taxTotal),
        totalAmount: filsToString(total),
        refundAmount: filsToString(refund),
        createdByUserId: user.id,
      },
      select: { id: true },
    });
    await tx.creditNoteItem.createMany({
      data: items.map((item) => ({ ...item, creditNoteId: note.id })),
    });
    const returned = await returnToAdvances(tx, user, {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      branchId: invoice.branchId,
      creditNoteId: note.id,
      creditNoteNumber,
      issueDate,
      fils: toAdvances,
    });

    const invoiceAfter = {
      totalAmount: invoice.totalAmount,
      creditedAmount: filsToString(creditedBefore + total),
      advanceAppliedAmount: filsToString(appliedBefore - returned),
    };
    const status = settlementStatus(invoiceAfter, paid);
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        creditedAmount: invoiceAfter.creditedAmount,
        advanceAppliedAmount: invoiceAfter.advanceAppliedAmount,
        status,
      },
    });
    await syncPosting(tx, user.organizationId, 'CREDIT_NOTE', note.id, user.id);

    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: invoice.branchId,
      actorUserId: user.id,
      action: 'credit_note.issued',
      entityType: 'CreditNote',
      entityId: note.id,
      afterData: {
        creditNoteNumber,
        issueDate: issueDay,
        reason: input.reason,
        subtotal: filsToString(subtotal),
        taxAmount: filsToString(taxTotal),
        totalAmount: filsToString(total),
        refundAmount: filsToString(refund),
        returnedToAdvances: filsToString(returned),
        lines: items.map((item) => ({
          invoiceItemId: item.invoiceItemId,
          lineTotal: item.lineTotal,
          discountAmount: item.discountAmount,
          taxAmount: item.taxAmount,
        })),
      },
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoiceStatusBefore: invoice.status,
        invoiceStatusAfter: status,
      },
    });
    await settleRequestKey(tx, user, rawInput, note.id);
    return {
      creditNoteId: note.id,
      creditNoteNumber,
      totalAmount: filsToString(total),
      refundAmount: filsToString(refund),
      returnedToAdvances: filsToString(returned),
    };
  });
}

// ---------------------------------------------------------------------------
// Refund
// ---------------------------------------------------------------------------

const refundSchema = z.object({
  refundedOn: z
    .string({ error: 'Enter the date of the refund.' })
    .trim()
    .min(1, 'Enter the date of the refund.'),
  method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'ONLINE'], {
    error: 'Choose how the money was paid back.',
  }),
  accountId: z.union([z.literal(''), z.uuid()]).optional(),
  reference: z.string().trim().max(100).optional(),
  requestKey: z.string().optional(),
});

/** Records the refund owed under a credit note as paid out to the customer. */
export async function recordCreditNoteRefund(
  user: AuthenticatedUser,
  creditNoteId: string,
  rawInput: unknown,
) {
  const input = parseInput(refundSchema, rawInput);
  const refundedOn = parseCalendarDate(input.refundedOn);
  if (!refundedOn) throw new DomainError('Enter the date of the refund.', 'refundedOn');
  if (input.refundedOn > localDateString()) {
    throw new DomainError('A refund cannot be dated in the future.', 'refundedOn');
  }

  return prisma.$transaction(async (tx) => {
    await claimRequestKey(tx, user, rawInput, 'credit_note.refund');
    await tx.$executeRaw`SELECT id FROM credit_notes WHERE id = ${creditNoteId}::uuid AND organization_id = ${user.organizationId}::uuid FOR UPDATE`;
    const note = await tx.creditNote.findFirst({
      where: { id: creditNoteId, organizationId: user.organizationId },
      select: {
        id: true,
        branchId: true,
        status: true,
        issueDate: true,
        creditNoteNumber: true,
        refundAmount: true,
        refundedOn: true,
      },
    });
    if (!note) throw new NotFoundError('credit note');
    requirePermission(user, 'payment.delete', { branchId: note.branchId });
    if (note.status !== 'ISSUED') throw new DomainError('This credit note is void.');
    if (fils(note.refundAmount) === 0) {
      throw new DomainError('Nothing is owed back to the customer under this credit note.');
    }
    if (note.refundedOn) throw new DomainError('The refund has already been recorded.');
    if (refundedOn < note.issueDate) {
      throw new DomainError('A refund cannot be dated before its credit note.', 'refundedOn');
    }
    const accountId = await checkMoneyAccount(tx, user.organizationId, input.accountId);

    await tx.creditNote.update({
      where: { id: note.id },
      data: {
        refundedOn,
        refundMethod: input.method,
        refundAccountId: accountId,
        refundReference: emptyToNull(input.reference),
      },
    });
    await syncPosting(tx, user.organizationId, 'CREDIT_NOTE_REFUND', note.id, user.id);
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: note.branchId,
      actorUserId: user.id,
      action: 'credit_note.refunded',
      entityType: 'CreditNote',
      entityId: note.id,
      afterData: {
        refundedOn: input.refundedOn,
        method: input.method,
        accountId,
        reference: emptyToNull(input.reference),
        amount: note.refundAmount.toString(),
      },
      metadata: { creditNoteNumber: note.creditNoteNumber },
    });
    await settleRequestKey(tx, user, rawInput, note.id);
    return { creditNoteId: note.id };
  });
}

// ---------------------------------------------------------------------------
// Void
// ---------------------------------------------------------------------------

const voidSchema = z.object({
  reason: z
    .string({ error: 'Say why.' })
    .trim()
    .min(3, 'Say why, in a few words.')
    .max(500, 'Keep the reason under 500 characters.'),
  requestKey: z.string().optional(),
});

/** Why a credit note can't be voided, or null when it can. */
export function creditNoteVoidBlocker(note: { status: string; refundedOn: Date | null }) {
  if (note.status !== 'ISSUED') return 'This credit note is already void.';
  if (note.refundedOn) {
    return 'A refund has been paid under this credit note, so it stands. Issue a new invoice if the customer is to be charged again.';
  }
  return null;
}

/**
 * Withdraws a credit note issued in error: the invoice is owed again in
 * full and the note's entry is reversed. Its number is never reused.
 */
export async function voidCreditNote(
  user: AuthenticatedUser,
  creditNoteId: string,
  rawInput: unknown,
) {
  const input = parseInput(voidSchema, rawInput);
  return prisma.$transaction(async (tx) => {
    await claimRequestKey(tx, user, rawInput, 'credit_note.void');
    const found = await tx.creditNote.findFirst({
      where: { id: creditNoteId, organizationId: user.organizationId },
      select: { id: true, invoiceId: true },
    });
    if (!found) throw new NotFoundError('credit note');
    // The invoice first, as everything that changes it does.
    await tx.$executeRaw`SELECT id FROM invoices WHERE id = ${found.invoiceId}::uuid FOR UPDATE`;
    await tx.$executeRaw`SELECT id FROM credit_notes WHERE id = ${found.id}::uuid FOR UPDATE`;
    const note = await tx.creditNote.findFirstOrThrow({
      where: { id: found.id },
      select: {
        id: true,
        branchId: true,
        status: true,
        refundedOn: true,
        creditNoteNumber: true,
        totalAmount: true,
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            status: true,
            totalAmount: true,
            creditedAmount: true,
            advanceAppliedAmount: true,
            payments: {
              select: { id: true, amount: true, status: true, reversalOfPaymentId: true },
            },
          },
        },
      },
    });
    requirePermission(user, 'credit_note.delete', { branchId: note.branchId });
    const blocker = creditNoteVoidBlocker(note);
    if (blocker) throw new DomainError(blocker);

    const invoice = note.invoice;
    // Money the note gave back to advances is applied to the invoice again.
    const restored = await undoReturnsToAdvances(
      tx,
      user,
      note.id,
      `Credit note ${note.creditNoteNumber} voided: ${input.reason}`,
    );
    const creditedAmount = filsToString(
      Math.max(fils(invoice.creditedAmount) - fils(note.totalAmount), 0),
    );
    const advanceAppliedAmount = filsToString(fils(invoice.advanceAppliedAmount) + restored);
    const status = settlementStatus(
      { totalAmount: invoice.totalAmount, creditedAmount, advanceAppliedAmount },
      paidFils(invoice.payments),
    );
    const voidedAt = new Date();
    await tx.creditNote.update({
      where: { id: note.id },
      data: { status: 'VOID', voidedAt, voidReason: input.reason },
    });
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { creditedAmount, advanceAppliedAmount, status },
    });
    await syncPosting(tx, user.organizationId, 'CREDIT_NOTE', note.id, user.id);

    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      branchId: note.branchId,
      actorUserId: user.id,
      action: 'credit_note.voided',
      entityType: 'CreditNote',
      entityId: note.id,
      beforeData: { status: 'ISSUED' },
      afterData: { status: 'VOID', voidedAt: voidedAt.toISOString(), reason: input.reason },
      metadata: {
        creditNoteNumber: note.creditNoteNumber,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoiceStatusAfter: status,
        reappliedFromAdvances: filsToString(restored),
      },
    });
    await settleRequestKey(tx, user, rawInput, note.id);
    return { creditNoteId: note.id, invoiceId: invoice.id };
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** One credit note, for its page and its printed copy. */
export async function getCreditNote(user: AuthenticatedUser, creditNoteId: string) {
  const note = await prisma.creditNote.findFirst({
    where: { id: creditNoteId, organizationId: user.organizationId },
    include: {
      items: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: { account: { select: { accountCode: true, accountName: true } } },
      },
      invoice: {
        select: {
          id: true,
          invoiceNumber: true,
          issueDate: true,
          totalAmount: true,
          creditedAmount: true,
          customerName: true,
          customerTaxNumber: true,
          jobCardId: true,
        },
      },
      customer: { select: { id: true, name: true, phone: true, taxNumber: true } },
      branch: { select: { name: true } },
      refundAccount: { select: { accountCode: true, accountName: true } },
      createdBy: { select: { fullName: true } },
    },
  });
  if (!note) throw new NotFoundError('credit note');
  requirePermission(user, 'credit_note.view', { branchId: note.branchId });
  return note;
}

export type CreditNoteDetail = Awaited<ReturnType<typeof getCreditNote>>;

/** The credit notes against one invoice, newest first. */
export async function listInvoiceCreditNotes(user: AuthenticatedUser, invoiceId: string) {
  requirePermission(user, 'credit_note.view');
  return prisma.creditNote.findMany({
    where: { organizationId: user.organizationId, invoiceId },
    orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      creditNoteNumber: true,
      status: true,
      issueDate: true,
      reason: true,
      totalAmount: true,
      refundAmount: true,
      refundedOn: true,
    },
  });
}

/** Every credit note, newest first, for the finance list. */
export async function listCreditNotes(
  user: AuthenticatedUser,
  filters: { q?: string; status?: 'ISSUED' | 'VOID' | 'REFUND_DUE' } = {},
) {
  requirePermission(user, 'credit_note.view');
  const q = filters.q?.trim();
  const where: Prisma.CreditNoteWhereInput = {
    organizationId: user.organizationId,
    ...(filters.status === 'VOID'
      ? { status: 'VOID' }
      : filters.status === 'REFUND_DUE'
        ? { status: 'ISSUED', refundAmount: { gt: 0 }, refundedOn: null }
        : filters.status === 'ISSUED'
          ? { status: 'ISSUED' }
          : {}),
    ...(q
      ? {
          OR: [
            { creditNoteNumber: { contains: q, mode: 'insensitive' } },
            { reason: { contains: q, mode: 'insensitive' } },
            { invoice: { invoiceNumber: { contains: q, mode: 'insensitive' } } },
            { customer: { name: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  return prisma.creditNote.findMany({
    where,
    orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
    take: 200,
    select: {
      id: true,
      creditNoteNumber: true,
      status: true,
      issueDate: true,
      reason: true,
      subtotal: true,
      taxAmount: true,
      totalAmount: true,
      refundAmount: true,
      refundedOn: true,
      invoice: { select: { id: true, invoiceNumber: true, customerName: true } },
      customer: { select: { name: true } },
    },
  });
}
