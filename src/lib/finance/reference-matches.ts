import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { formatDate, formatMoney } from '@/lib/format';

/*
 * Payment references — cheque, card-slip and transfer numbers — repeat
 * legitimately (one customer cheque can settle two invoices), so a repeat is
 * never refused. Instead the form asks here once the reference is typed, and
 * shows any live entry already carrying it so a double entry is caught before
 * saving. Reversed, voided and cancelled entries don't count. Each kind is
 * only searched when the user may view it.
 */

export interface ReferenceMatch {
  label: string;
  detail: string;
  href: string;
}

const PER_KIND = 3;
const MAX_MATCHES = 5;

/** Org-wide or in any branch: enough to be shown that the entry exists. */
function canView(user: AuthenticatedUser, code: string) {
  if (user.orgWidePermissions.has(code)) return true;
  for (const codes of user.branchPermissions.values()) if (codes.has(code)) return true;
  return false;
}

const line = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ');

export async function findReferenceMatches(
  user: AuthenticatedUser,
  rawReference: unknown,
  /** The expense being edited, so it doesn't match itself. */
  exceptExpenseId?: string,
): Promise<ReferenceMatch[]> {
  const reference = typeof rawReference === 'string' ? rawReference.trim().replace(/\s+/g, ' ') : '';
  // "1", "NA", "-" and the like are not references worth matching.
  if (reference.length < 3 || reference.length > 100) return [];
  const organizationId = user.organizationId;
  const same = { equals: reference, mode: 'insensitive' as const };
  const none = Promise.resolve([] as ReferenceMatch[]);

  const groups = await Promise.all([
    canView(user, 'payment.view')
      ? prisma.payment
          .findMany({
            where: {
              organizationId,
              referenceNumber: same,
              reversalOfPaymentId: null,
              reversals: { none: {} },
            },
            orderBy: { receivedAt: 'desc' },
            take: PER_KIND,
            select: {
              paymentNumber: true,
              amount: true,
              receivedAt: true,
              invoice: { select: { id: true, invoiceNumber: true, customerName: true } },
            },
          })
          .then((rows) =>
            rows.map((p) => ({
              label: `Receipt ${p.paymentNumber ?? ''}`.trim(),
              detail: line(
                formatMoney(p.amount),
                formatDate(p.receivedAt),
                `invoice ${p.invoice.invoiceNumber}`,
                p.invoice.customerName,
              ),
              href: `/finance/invoices/${p.invoice.id}`,
            })),
          )
      : none,
    canView(user, 'supplier_payment.view')
      ? prisma.supplierPayment
          .findMany({
            where: { organizationId, referenceNumber: same, status: 'COMPLETED' },
            orderBy: { paidAt: 'desc' },
            take: PER_KIND,
            select: {
              supplierPaymentNumber: true,
              amount: true,
              paidAt: true,
              purchase: {
                select: { id: true, purchaseNumber: true, supplier: { select: { name: true } } },
              },
            },
          })
          .then((rows) =>
            rows.map((p) => ({
              label: `Supplier payment ${p.supplierPaymentNumber ?? ''}`.trim(),
              detail: line(
                formatMoney(p.amount),
                formatDate(p.paidAt),
                `purchase ${p.purchase.purchaseNumber}`,
                p.purchase.supplier.name,
              ),
              href: `/inventory/purchases/${p.purchase.id}`,
            })),
          )
      : none,
    canView(user, 'customer_advance.view')
      ? prisma.customerAdvance
          .findMany({
            where: { organizationId, reference: same, cancelledAt: null },
            orderBy: { receivedOn: 'desc' },
            take: PER_KIND,
            select: {
              id: true,
              advanceNumber: true,
              amount: true,
              receivedOn: true,
              customer: { select: { name: true } },
            },
          })
          .then((rows) =>
            rows.map((a) => ({
              label: `Advance ${a.advanceNumber}`,
              detail: line(formatMoney(a.amount), formatDate(a.receivedOn), a.customer.name),
              href: `/finance/advances/${a.id}`,
            })),
          )
      : none,
    canView(user, 'customer_advance.view')
      ? prisma.customerAdvanceRefund
          .findMany({
            where: { organizationId, reference: same, reversedAt: null },
            orderBy: { refundedOn: 'desc' },
            take: PER_KIND,
            select: {
              amount: true,
              refundedOn: true,
              advance: { select: { id: true, advanceNumber: true } },
            },
          })
          .then((rows) =>
            rows.map((r) => ({
              label: `Refund of advance ${r.advance.advanceNumber}`,
              detail: line(formatMoney(r.amount), formatDate(r.refundedOn)),
              href: `/finance/advances/${r.advance.id}`,
            })),
          )
      : none,
    canView(user, 'credit_note.view')
      ? prisma.creditNote
          .findMany({
            where: { organizationId, refundReference: same, voidedAt: null },
            orderBy: { issueDate: 'desc' },
            take: PER_KIND,
            select: {
              id: true,
              creditNoteNumber: true,
              refundAmount: true,
              refundedOn: true,
              customer: { select: { name: true } },
            },
          })
          .then((rows) =>
            rows.map((c) => ({
              label: `Refund on credit note ${c.creditNoteNumber}`,
              detail: line(
                formatMoney(c.refundAmount),
                c.refundedOn ? formatDate(c.refundedOn) : null,
                c.customer.name,
              ),
              href: `/finance/credit-notes/${c.id}`,
            })),
          )
      : none,
    canView(user, 'expense.view')
      ? prisma.expense
          .findMany({
            where: {
              organizationId,
              paymentReference: same,
              status: 'RECORDED',
              ...(exceptExpenseId ? { id: { not: exceptExpenseId } } : {}),
            },
            orderBy: { expenseDate: 'desc' },
            take: PER_KIND,
            select: {
              id: true,
              expenseNumber: true,
              description: true,
              amount: true,
              taxAmount: true,
              expenseDate: true,
              vendorName: true,
            },
          })
          .then((rows) =>
            rows.map((e) => ({
              label: `Expense ${e.expenseNumber ?? e.description}`,
              detail: line(
                formatMoney(Number(e.amount) + Number(e.taxAmount ?? 0)),
                formatDate(e.expenseDate),
                e.vendorName,
              ),
              href: `/finance/expenses/${e.id}`,
            })),
          )
      : none,
    canView(user, 'money.view')
      ? prisma.moneyTransfer
          .findMany({
            where: { organizationId, reference: same, voidedAt: null },
            orderBy: { transferredOn: 'desc' },
            take: PER_KIND,
            select: {
              transferNumber: true,
              amount: true,
              transferredOn: true,
              fromAccount: { select: { accountName: true } },
              toAccount: { select: { accountName: true } },
            },
          })
          .then((rows) =>
            rows.map((t) => ({
              label: `Transfer ${t.transferNumber}`,
              detail: line(
                formatMoney(t.amount),
                formatDate(t.transferredOn),
                `${t.fromAccount.accountName} → ${t.toAccount.accountName}`,
              ),
              href: '/finance/money/transfers',
            })),
          )
      : none,
    canView(user, 'accounting.view')
      ? prisma.ownerReimbursement
          .findMany({
            where: { organizationId, reference: same, status: 'COMPLETED' },
            orderBy: { paidOn: 'desc' },
            take: PER_KIND,
            select: { amount: true, paidOn: true, person: { select: { fullName: true } } },
          })
          .then((rows) =>
            rows.map((r) => ({
              label: `Repayment to ${r.person.fullName}`,
              detail: line(formatMoney(r.amount), formatDate(r.paidOn)),
              href: '/finance/owner-advances',
            })),
          )
      : none,
  ]);

  return groups.flat().slice(0, MAX_MATCHES);
}
