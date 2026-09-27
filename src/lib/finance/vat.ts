import type { InvoiceStatus } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { calculateLine, filsToString, milliToString, signedToMilli, toFils } from '@/lib/money';
import { parseCalendarDate } from '@/lib/format';
import { getVatSettings } from '@/lib/tax';
import { resolvePeriod, type ResolvedPeriod } from '@/lib/finance/dashboard';

/*
 * The VAT return for a period — the figures a UAE VAT201 asks for, taken
 * from the records the workshop already keeps. It prepares the return; it
 * does not file it, and it is not a tax engine (see lib/tax.ts).
 *
 * OUTPUT TAX — sales
 *   Tax invoices issued in the period (ISSUED, PARTIALLY_PAID, PAID), at
 *   their own stored subtotal and VAT. Pro-forma invoices are not supplies;
 *   DRAFT, VOID and CANCELLED never count. Lines charged at 0% are reported
 *   as zero-rated; any whole-bill discount is spread over the lines in
 *   proportion, so standard + zero-rated always equals the invoice subtotal.
 *
 * INPUT TAX — what the workshop can recover
 *   Expenses dated in the period that carry VAT (voided ones never count),
 *   and parts received into stock in the period, valued per delivery from
 *   the purchase line's cost and VAT rate. Dated by delivery, not by order:
 *   VAT is recoverable once the goods and the supplier's invoice arrive.
 *
 * A workshop that is not VAT-registered charges and recovers nothing; the
 * return shows zeros and says why.
 *
 * All arithmetic is integer fils. Periods are Dubai calendar days, exactly
 * as on the finance overview.
 */

const SUPPLY_STATUSES: InvoiceStatus[] = ['ISSUED', 'PARTIALLY_PAID', 'PAID'];

const fils = (value: { toString(): string } | null | undefined) =>
  value ? toFils(value.toString()) : 0;

/** Half-up rounding of a non-negative integer ratio. */
const divRound = (numerator: number, denominator: number) =>
  Math.floor((numerator * 2 + denominator) / (denominator * 2));

export interface VatReturnInput {
  period?: string;
  from?: string;
  to?: string;
}

/**
 * Splits an invoice's taxable subtotal into its standard-rated and
 * zero-rated parts, in fils.
 */
export function splitSupplies(
  subtotalFils: number,
  lines: { lineTotal: { toString(): string }; taxRate: { toString(): string } | null }[],
) {
  const linesFils = lines.reduce((sum, line) => sum + fils(line.lineTotal), 0);
  const zeroLinesFils = lines
    .filter((line) => !line.taxRate || fils(line.taxRate) === 0)
    .reduce((sum, line) => sum + fils(line.lineTotal), 0);
  const zero =
    linesFils > 0 && zeroLinesFils > 0
      ? Math.min(subtotalFils, divRound(zeroLinesFils * subtotalFils, linesFils))
      : 0;
  return { standard: subtotalFils - zero, zero };
}

export async function getVatReturn(user: AuthenticatedUser, input: VatReturnInput = {}) {
  requirePermission(user, 'accounting.view');
  const period: ResolvedPeriod = resolvePeriod({ ...input, period: input.period ?? 'quarter' });
  const organizationId = user.organizationId;
  const branch = user.primaryBranchId ? { branchId: user.primaryBranchId } : {};
  const dates = { gte: parseCalendarDate(period.from)!, lte: parseCalendarDate(period.to)! };

  const [settings, invoices, expenses, receipts] = await Promise.all([
    getVatSettings(organizationId),
    prisma.invoice.findMany({
      where: {
        organizationId,
        ...branch,
        invoiceType: 'TAX_INVOICE',
        status: { in: SUPPLY_STATUSES },
        issueDate: dates,
      },
      orderBy: [{ issueDate: 'asc' }, { invoiceNumber: 'asc' }],
      select: {
        id: true,
        invoiceNumber: true,
        issueDate: true,
        subtotal: true,
        taxAmount: true,
        totalAmount: true,
        customerName: true,
        customerTaxNumber: true,
        jobCardId: true,
        customer: { select: { name: true, taxNumber: true } },
        items: { select: { lineTotal: true, taxRate: true } },
      },
    }),
    prisma.expense.findMany({
      where: { organizationId, ...branch, status: 'RECORDED', expenseDate: dates },
      orderBy: [{ expenseDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        expenseNumber: true,
        description: true,
        vendorName: true,
        expenseDate: true,
        amount: true,
        taxAmount: true,
        chartOfAccount: { select: { accountName: true } },
      },
    }),
    prisma.inventoryTransaction.findMany({
      where: {
        organizationId,
        ...branch,
        transactionType: 'PURCHASE_RECEIPT',
        createdAt: { gte: period.start, lt: period.end },
        purchaseItem: { purchase: { status: { notIn: ['CANCELLED', 'REVERSED'] } } },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        quantity: true,
        createdAt: true,
        purchaseItem: {
          select: {
            unitCost: true,
            taxRate: true,
            purchase: {
              select: {
                id: true,
                purchaseNumber: true,
                supplierInvoiceNumber: true,
                supplier: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const registered = settings.isVatRegistered;
  const defaultRate = registered ? settings.vatRate : '0.00';

  // ── Sales ───────────────────────────────────────────────────────────────
  let standardFils = 0;
  let zeroFils = 0;
  let outputFils = 0;
  const sales = invoices.map((invoice) => {
    const subtotal = fils(invoice.subtotal);
    const split = splitSupplies(subtotal, invoice.items);
    const vat = fils(invoice.taxAmount);
    standardFils += split.standard;
    zeroFils += split.zero;
    outputFils += vat;
    return {
      id: invoice.id,
      number: invoice.invoiceNumber,
      date: invoice.issueDate,
      jobCardId: invoice.jobCardId,
      party: invoice.customerName ?? invoice.customer.name,
      taxNumber: invoice.customerTaxNumber ?? invoice.customer.taxNumber,
      net: filsToString(subtotal),
      vat: filsToString(vat),
      total: invoice.totalAmount.toString(),
    };
  });

  // ── Expenses with VAT ───────────────────────────────────────────────────
  let expenseNetFils = 0;
  let expenseVatFils = 0;
  const expenseRows = expenses
    .filter((expense) => fils(expense.taxAmount) > 0)
    .map((expense) => {
      const net = fils(expense.amount);
      const vat = fils(expense.taxAmount);
      expenseNetFils += net;
      expenseVatFils += vat;
      return {
        id: expense.id,
        number: expense.expenseNumber,
        date: expense.expenseDate,
        party: expense.vendorName ?? expense.chartOfAccount?.accountName ?? 'Expense',
        description: expense.description,
        net: filsToString(net),
        vat: filsToString(vat),
      };
    });

  // ── Parts received, grouped per purchase ────────────────────────────────
  const byPurchase = new Map<
    string,
    {
      id: string;
      number: string;
      reference: string | null;
      party: string;
      date: Date;
      net: number;
      vat: number;
    }
  >();
  for (const receipt of receipts) {
    const item = receipt.purchaseItem;
    const qty = signedToMilli(receipt.quantity);
    if (!item || qty <= 0) continue;
    const amounts = calculateLine({
      quantity: milliToString(qty),
      unitPrice: item.unitCost.toString(),
      taxRate: item.taxRate?.toString() ?? defaultRate,
    });
    const purchase = item.purchase;
    const entry = byPurchase.get(purchase.id) ?? {
      id: purchase.id,
      number: purchase.purchaseNumber,
      reference: purchase.supplierInvoiceNumber,
      party: purchase.supplier.name,
      date: receipt.createdAt,
      net: 0,
      vat: 0,
    };
    entry.net += amounts.lineTotalFils;
    entry.vat += amounts.taxFils;
    entry.date = receipt.createdAt;
    byPurchase.set(purchase.id, entry);
  }
  let purchaseNetFils = 0;
  let purchaseVatFils = 0;
  const purchaseRows = [...byPurchase.values()]
    .filter((row) => row.vat > 0)
    .map((row) => {
      purchaseNetFils += row.net;
      purchaseVatFils += row.vat;
      return { ...row, net: filsToString(row.net), vat: filsToString(row.vat) };
    });

  const output = registered ? outputFils : 0;
  const inputFils = registered ? expenseVatFils + purchaseVatFils : 0;

  return {
    period,
    registered,
    rate: settings.vatRate,
    taxNumber: settings.taxNumber,
    boxes: {
      /** Box 1 — standard-rated supplies. */
      standardSupplies: filsToString(registered ? standardFils : 0),
      outputVat: filsToString(output),
      /** Box 4 — zero-rated supplies. */
      zeroRatedSupplies: filsToString(registered ? zeroFils : 0),
      /** Box 8 — total supplies. */
      totalSupplies: filsToString(registered ? standardFils + zeroFils : 0),
      /** Box 9 — standard-rated expenses (expenses + parts received). */
      standardExpenses: filsToString(registered ? expenseNetFils + purchaseNetFils : 0),
      inputVat: filsToString(inputFils),
      expenseVat: filsToString(registered ? expenseVatFils : 0),
      purchaseVat: filsToString(registered ? purchaseVatFils : 0),
      /** Box 14 — positive is payable, negative is refundable. */
      net: filsToString(output - inputFils),
      netFils: output - inputFils,
    },
    sales,
    expenses: expenseRows,
    purchases: purchaseRows,
  };
}

export type VatReturn = Awaited<ReturnType<typeof getVatReturn>>;
