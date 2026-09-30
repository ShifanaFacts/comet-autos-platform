import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { filsToString, milliToString, signedToMilli, toFils } from '@/lib/money';
import { localDateString, parseCalendarDate } from '@/lib/format';
import { resolveDefaultVatRate } from '@/lib/tax';
import { purchaseLineAmounts } from '@/lib/inventory/purchases';
import { PAYMENT_METHOD_LABEL } from '@/lib/documents/build';
import { dueFils, paidFils } from '@/lib/billing/invoice';

/*
 * Statements of account — what a customer owes the workshop, and what the
 * workshop owes a supplier, transaction by transaction over a period, with
 * the balance brought forward and a running balance. The document an
 * accountant sends with a reminder, or checks against a supplier's own
 * statement.
 *
 * CUSTOMER (debit = the customer owes more)
 *   Tax invoices issued        debit   (pro-forma invoices are not owed;
 *                                       void invoices never were)
 *   Payments received          credit
 *   Payments reversed          debit
 *   Credit notes issued        credit  (void ones never counted)
 *   Refunds paid under them    debit
 *
 * SUPPLIER (credit = the workshop owes more)
 *   Parts received             credit  valued per delivery, VAT included —
 *   Parts returned             debit   exactly as the books value them
 *   Payments made              debit
 *   Payments reversed          credit
 *
 * Each follows the same rules as the ledger's trade receivables and trade
 * payables, so a statement's closing balance is that customer's or
 * supplier's share of those accounts. Dates are Dubai calendar days.
 */

export interface StatementLine {
  key: string;
  date: string;
  kind: string;
  reference: string;
  description: string;
  /** Link to the document behind it, when it has a page. */
  href: string | null;
  debit: string;
  credit: string;
  /** Running balance after this line: positive is owed to / by the workshop as the statement reads. */
  balance: string;
}

interface Movement {
  key: string;
  date: string;
  /** Tie-break within a day: documents before the money against them. */
  order: number;
  kind: string;
  reference: string;
  description: string;
  href: string | null;
  /** Signed in the statement's direction: positive raises the balance. */
  fils: number;
}

export interface StatementPeriod {
  from?: string;
  to?: string;
}

function resolveStatementPeriod(input: StatementPeriod) {
  const today = localDateString();
  const to = input.to && parseCalendarDate(input.to) ? input.to : today;
  // Default: the start of the year, a common statement period.
  const from =
    input.from && parseCalendarDate(input.from) && input.from <= to
      ? input.from
      : `${to.slice(0, 4)}-01-01`;
  return { from, to };
}

/** Opening balance, the lines in the period with a running balance, and the closing balance. */
function statementFrom(movements: Movement[], period: { from: string; to: string }) {
  movements.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.order - b.order || a.reference.localeCompare(b.reference),
  );
  let opening = 0;
  let running = 0;
  let debits = 0;
  let credits = 0;
  const lines: StatementLine[] = [];
  for (const movement of movements) {
    if (movement.date > period.to) continue;
    if (movement.date < period.from) {
      opening += movement.fils;
      running = opening;
      continue;
    }
    running += movement.fils;
    if (movement.fils >= 0) debits += movement.fils;
    else credits -= movement.fils;
    lines.push({
      key: movement.key,
      date: movement.date,
      kind: movement.kind,
      reference: movement.reference,
      description: movement.description,
      href: movement.href,
      debit: movement.fils > 0 ? filsToString(movement.fils) : '',
      credit: movement.fils < 0 ? filsToString(-movement.fils) : '',
      balance: signed(running),
    });
  }
  return {
    period,
    opening: signed(opening),
    lines,
    totalDebits: filsToString(debits),
    totalCredits: filsToString(credits),
    closing: signed(running),
  };
}

const signed = (fils: number) => (fils < 0 ? `-${filsToString(-fils)}` : filsToString(fils));

const day = (date: Date) => localDateString(date);
const calendarDay = (date: Date) => date.toISOString().slice(0, 10);

// ─── Customers ──────────────────────────────────────────────────────────────

const AGEING_BUCKETS = [
  { label: 'Not yet due', max: 0 },
  { label: '1–30 days', max: 30 },
  { label: '31–60 days', max: 60 },
  { label: '61–90 days', max: 90 },
  { label: 'Over 90 days', max: Infinity },
] as const;

export async function getCustomerStatement(
  user: AuthenticatedUser,
  customerId: string,
  input: StatementPeriod = {},
) {
  requirePermission(user, 'invoice.view');
  const organizationId = user.organizationId;
  const period = resolveStatementPeriod(input);
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, organizationId },
    select: { id: true, name: true, phone: true, email: true, taxNumber: true, address: true },
  });
  if (!customer) throw new NotFoundError('customer');

  const [invoices, creditNotes] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        organizationId,
        customerId,
        // An opening balance is owed like an invoice; pro-forma never is.
        invoiceType: { in: ['TAX_INVOICE', 'OPENING_BALANCE'] },
        status: { notIn: ['DRAFT', 'VOID', 'CANCELLED'] },
      },
      select: {
        id: true,
        invoiceNumber: true,
        issueDate: true,
        dueDate: true,
        totalAmount: true,
        creditedAmount: true,
        jobCard: { select: { jobNumber: true } },
        vehicle: { select: { plateNumber: true } },
        payments: {
          select: {
            id: true,
            paymentNumber: true,
            amount: true,
            status: true,
            method: true,
            referenceNumber: true,
            reversalOfPaymentId: true,
            receivedAt: true,
          },
        },
      },
    }),
    prisma.creditNote.findMany({
      where: { organizationId, customerId, status: 'ISSUED' },
      select: {
        id: true,
        creditNoteNumber: true,
        issueDate: true,
        totalAmount: true,
        refundAmount: true,
        refundedOn: true,
        refundMethod: true,
        reason: true,
        invoice: { select: { invoiceNumber: true } },
      },
    }),
  ]);

  const movements: Movement[] = [];
  for (const invoice of invoices) {
    const about = [invoice.vehicle?.plateNumber, invoice.jobCard?.jobNumber]
      .filter(Boolean)
      .join(' · ');
    movements.push({
      key: `invoice-${invoice.id}`,
      date: calendarDay(invoice.issueDate),
      order: 0,
      kind: 'Invoice',
      reference: invoice.invoiceNumber,
      description: about ? `Tax invoice — ${about}` : 'Tax invoice',
      href: `/finance/invoices/${invoice.id}`,
      fils: toFils(invoice.totalAmount.toString()),
    });
    const numbers = new Map(invoice.payments.map((p) => [p.id, p.paymentNumber]));
    for (const payment of invoice.payments) {
      const amount = toFils(payment.amount.toString());
      if (payment.reversalOfPaymentId) {
        movements.push({
          key: `payment-${payment.id}`,
          date: day(payment.receivedAt),
          order: 3,
          kind: 'Payment reversed',
          reference: numbers.get(payment.reversalOfPaymentId) ?? invoice.invoiceNumber,
          description: `Reversal of a payment on ${invoice.invoiceNumber}`,
          href: `/finance/invoices/${invoice.id}`,
          fils: amount,
        });
      } else if (payment.status === 'COMPLETED') {
        movements.push({
          key: `payment-${payment.id}`,
          date: day(payment.receivedAt),
          order: 2,
          kind: 'Payment',
          reference: payment.paymentNumber ?? invoice.invoiceNumber,
          description: `${PAYMENT_METHOD_LABEL[payment.method]} against ${invoice.invoiceNumber}${payment.referenceNumber ? ` (${payment.referenceNumber})` : ''}`,
          href: `/finance/invoices/${invoice.id}`,
          fils: -amount,
        });
      }
    }
  }
  for (const note of creditNotes) {
    movements.push({
      key: `credit-${note.id}`,
      date: calendarDay(note.issueDate),
      order: 1,
      kind: 'Credit note',
      reference: note.creditNoteNumber,
      description: `Against ${note.invoice.invoiceNumber} — ${note.reason}`,
      href: `/finance/credit-notes/${note.id}`,
      fils: -toFils(note.totalAmount.toString()),
    });
    if (note.refundedOn) {
      movements.push({
        key: `refund-${note.id}`,
        date: calendarDay(note.refundedOn),
        order: 3,
        kind: 'Refund',
        reference: note.creditNoteNumber,
        description: `Refund paid${note.refundMethod ? ` by ${PAYMENT_METHOD_LABEL[note.refundMethod].toLowerCase()}` : ''}`,
        href: `/finance/credit-notes/${note.id}`,
        fils: toFils(note.refundAmount.toString()),
      });
    }
  }

  // Ageing of what is unpaid today, by how long past its due date.
  const today = localDateString();
  const ageing = AGEING_BUCKETS.map((bucket) => ({ label: bucket.label, fils: 0 }));
  const open = invoices
    .map((invoice) => ({
      id: invoice.id,
      number: invoice.invoiceNumber,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate ?? invoice.issueDate,
      due: dueFils(invoice, paidFils(invoice.payments)),
    }))
    .filter((invoice) => invoice.due > 0)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  for (const invoice of open) {
    const overdue = Math.floor(
      (Date.parse(today) - Date.parse(calendarDay(invoice.dueDate))) / 86_400_000,
    );
    const index = AGEING_BUCKETS.findIndex((bucket) => overdue <= bucket.max);
    ageing[index].fils += invoice.due;
  }

  return {
    party: customer,
    ...statementFrom(movements, period),
    openInvoices: open.map((invoice) => ({ ...invoice, due: filsToString(invoice.due) })),
    ageing: ageing.map((bucket) => ({ label: bucket.label, amount: filsToString(bucket.fils) })),
    totalDue: filsToString(open.reduce((sum, invoice) => sum + invoice.due, 0)),
  };
}

export type CustomerStatement = Awaited<ReturnType<typeof getCustomerStatement>>;

// ─── Suppliers ──────────────────────────────────────────────────────────────

export async function getSupplierStatement(
  user: AuthenticatedUser,
  supplierId: string,
  input: StatementPeriod = {},
) {
  requirePermission(user, 'supplier_payment.view');
  const organizationId = user.organizationId;
  const period = resolveStatementPeriod(input);
  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, organizationId },
    select: { id: true, name: true, phone: true, email: true, address: true, contactName: true },
  });
  if (!supplier) throw new NotFoundError('supplier');

  const [movementsIn, payments, defaultVat] = await Promise.all([
    prisma.inventoryTransaction.findMany({
      where: {
        organizationId,
        transactionType: { in: ['PURCHASE_RECEIPT', 'RETURN_TO_SUPPLIER'] },
        unitCost: { not: null },
        purchaseItem: { purchase: { supplierId } },
      },
      select: {
        id: true,
        transactionType: true,
        quantity: true,
        unitCost: true,
        createdAt: true,
        part: { select: { name: true } },
        purchaseItem: {
          select: {
            taxRate: true,
            purchase: {
              select: { id: true, purchaseNumber: true, supplierInvoiceNumber: true },
            },
          },
        },
      },
    }),
    prisma.supplierPayment.findMany({
      where: { organizationId, purchase: { supplierId } },
      select: {
        id: true,
        supplierPaymentNumber: true,
        amount: true,
        status: true,
        method: true,
        referenceNumber: true,
        reversalOfSupplierPaymentId: true,
        paidAt: true,
        purchase: { select: { id: true, purchaseNumber: true } },
      },
    }),
    resolveDefaultVatRate(organizationId),
  ]);

  // One line per purchase per day: a delivery of many parts reads as one bill.
  const deliveries = new Map<string, Movement>();
  for (const row of movementsIn) {
    const purchase = row.purchaseItem?.purchase;
    if (!purchase || !row.unitCost) continue;
    const qty = signedToMilli(row.quantity);
    if (qty === 0) continue;
    const amounts = purchaseLineAmounts(
      milliToString(Math.abs(qty)),
      row.unitCost.toString(),
      row.purchaseItem?.taxRate?.toString() ?? defaultVat,
    );
    const value = amounts.lineTotalFils + amounts.taxFils;
    const returned = row.transactionType === 'RETURN_TO_SUPPLIER' || qty < 0;
    const date = day(row.createdAt);
    const key = `${returned ? 'return' : 'receipt'}-${purchase.id}-${date}`;
    const entry = deliveries.get(key) ?? {
      key,
      date,
      order: returned ? 1 : 0,
      kind: returned ? 'Parts returned' : 'Parts received',
      reference: purchase.purchaseNumber,
      description: purchase.supplierInvoiceNumber
        ? `Supplier invoice ${purchase.supplierInvoiceNumber}`
        : 'Delivery',
      href: `/inventory/purchases/${purchase.id}`,
      fils: 0,
    };
    // Owed more on a delivery, less on a return.
    entry.fils += returned ? -value : value;
    deliveries.set(key, entry);
  }

  const movements: Movement[] = [...deliveries.values()];
  const numbers = new Map(payments.map((p) => [p.id, p.supplierPaymentNumber]));
  for (const payment of payments) {
    const amount = toFils(payment.amount.toString());
    if (payment.reversalOfSupplierPaymentId) {
      movements.push({
        key: `payment-${payment.id}`,
        date: day(payment.paidAt),
        order: 3,
        kind: 'Payment reversed',
        reference:
          numbers.get(payment.reversalOfSupplierPaymentId) ?? payment.purchase.purchaseNumber,
        description: `Reversal of a payment for ${payment.purchase.purchaseNumber}`,
        href: `/inventory/purchases/${payment.purchase.id}`,
        fils: amount,
      });
    } else if (payment.status === 'COMPLETED') {
      movements.push({
        key: `payment-${payment.id}`,
        date: day(payment.paidAt),
        order: 2,
        kind: 'Payment',
        reference: payment.supplierPaymentNumber ?? payment.purchase.purchaseNumber,
        description: `${PAYMENT_METHOD_LABEL[payment.method]} for ${payment.purchase.purchaseNumber}${payment.referenceNumber ? ` (${payment.referenceNumber})` : ''}`,
        href: `/inventory/purchases/${payment.purchase.id}`,
        fils: -amount,
      });
    }
  }
  // Read from the workshop's side: what it owes is a credit balance.
  const flipped = movements.map((movement) => ({ ...movement, fils: -movement.fils }));
  const statement = statementFrom(flipped, period);
  return { party: supplier, ...statement };
}

export type SupplierStatement = Awaited<ReturnType<typeof getSupplierStatement>>;

/** Customers and suppliers to choose from on the statements screen. */
export async function getStatementParties(user: AuthenticatedUser, q: string) {
  requirePermission(user, 'invoice.view');
  const query = q.trim();
  const where = query ? { name: { contains: query, mode: 'insensitive' as const } } : {};
  const [customers, suppliers] = await Promise.all([
    prisma.customer.findMany({
      where: { organizationId: user.organizationId, ...where },
      orderBy: { name: 'asc' },
      take: 30,
      select: { id: true, name: true, phone: true },
    }),
    prisma.supplier.findMany({
      where: { organizationId: user.organizationId, ...where },
      orderBy: { name: 'asc' },
      take: 30,
      select: { id: true, name: true, phone: true },
    }),
  ]);
  return { customers, suppliers };
}

/** Who the statement is from, as printed at its head. */
export async function getStatementIssuer(user: AuthenticatedUser) {
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: user.organizationId },
    select: {
      name: true,
      legalName: true,
      address: true,
      phone: true,
      email: true,
      taxNumber: true,
    },
  });
  return organization;
}
