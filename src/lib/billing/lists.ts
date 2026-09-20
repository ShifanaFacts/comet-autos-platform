import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { invoiceBalance, paidFils } from '@/lib/billing/invoice';
import { PAYMENT_METHOD_LABEL } from '@/lib/documents/build';

/*
 * Read-only finance lists over what billing already records. Paid and
 * balance come from the billing rules (invoiceBalance) — nothing is
 * recalculated differently here.
 */

export type InvoiceFilter = '' | 'unpaid' | 'paid';

export async function listInvoices(
  user: AuthenticatedUser,
  filters: { q?: string; status?: string },
) {
  requirePermission(user, 'invoice.view');
  const q = filters.q?.trim();
  const status = (
    ['unpaid', 'paid'].includes(filters.status ?? '') ? filters.status : ''
  ) as InvoiceFilter;
  const invoices = await prisma.invoice.findMany({
    where: {
      organizationId: user.organizationId,
      status:
        status === 'unpaid'
          ? { in: ['ISSUED', 'PARTIALLY_PAID'] }
          : status === 'paid'
            ? 'PAID'
            : { notIn: ['DRAFT', 'VOID', 'CANCELLED'] },
      ...(q
        ? {
            OR: [
              { invoiceNumber: { contains: q, mode: 'insensitive' } },
              { customerName: { contains: q, mode: 'insensitive' } },
              { jobCard: { jobNumber: { contains: q, mode: 'insensitive' } } },
              { jobCard: { vehicle: { plateNumber: { contains: q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    },
    orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
    take: 200,
    select: {
      id: true,
      invoiceNumber: true,
      issueDate: true,
      status: true,
      totalAmount: true,
      customerName: true,
      payments: {
        select: {
          id: true,
          amount: true,
          status: true,
          reversalOfPaymentId: true,
          receivedAt: true,
        },
      },
      jobCard: {
        select: {
          id: true,
          jobNumber: true,
          vehicle: { select: { plateNumber: true, make: true, model: true } },
        },
      },
    },
  });
  return {
    status,
    invoices: invoices.map(({ payments, ...invoice }) => ({
      ...invoice,
      balance: invoiceBalance({ ...invoice, payments }),
    })),
  };
}

export async function listPayments(user: AuthenticatedUser, filters: { q?: string }) {
  requirePermission(user, 'invoice.view');
  const q = filters.q?.trim();
  const payments = await prisma.payment.findMany({
    where: {
      organizationId: user.organizationId,
      ...(q
        ? {
            OR: [
              { paymentNumber: { contains: q, mode: 'insensitive' } },
              { referenceNumber: { contains: q, mode: 'insensitive' } },
              { invoice: { invoiceNumber: { contains: q, mode: 'insensitive' } } },
              { invoice: { customerName: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    },
    orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
    take: 200,
    select: {
      id: true,
      paymentNumber: true,
      amount: true,
      method: true,
      status: true,
      referenceNumber: true,
      reversalOfPaymentId: true,
      receivedAt: true,
      receivedBy: { select: { fullName: true } },
      invoice: {
        select: {
          invoiceNumber: true,
          customerName: true,
          jobCard: { select: { id: true, jobNumber: true } },
        },
      },
    },
  });
  return {
    payments: payments.map((p) => ({ ...p, methodLabel: PAYMENT_METHOD_LABEL[p.method] })),
    totalShown: paidFils(payments.filter((p) => !p.reversalOfPaymentId)),
  };
}
