import type { InvoiceStatus } from '@/generated/prisma/client';
import type { VatTreatment } from '@/generated/prisma/enums';
import { EMIRATE_BOX, treatmentFromRate } from '@/lib/vat-treatment';
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
 *   DRAFT, VOID and CANCELLED never count. Each line is reported by its VAT
 *   treatment — standard-rated (Box 1, against the workshop's emirate),
 *   zero-rated (Box 4), exempt (Box 5); out-of-scope lines are not supplies
 *   and are not reported. A whole-bill discount is spread over the lines in
 *   proportion, so the parts always add up to the invoice subtotal.
 *
 *   Tax credit notes issued in the period reduce the same boxes and the
 *   output VAT: a supply is adjusted in the period the credit note is
 *   issued, not the invoice's.
 *
 * INPUT TAX — what the workshop can recover
 *   Expenses dated in the period that carry VAT (voided ones never count),
 *   and parts received into stock in the period, valued per delivery from
 *   the purchase line's cost and VAT rate, less parts returned to the
 *   supplier in the period. Dated by delivery, not by order: VAT is
 *   recoverable once the goods and the supplier's invoice arrive.
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

export type SupplySplit = Record<VatTreatment, number>;

const TREATMENT_ORDER: VatTreatment[] = ['STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE'];

export interface VatReturnInput {
  period?: string;
  from?: string;
  to?: string;
}

/**
 * Splits a document's subtotal (after any bill discount) by VAT treatment,
 * in fils, in proportion to its lines. Largest remainder, so the parts always
 * add up to the subtotal exactly.
 */
export function splitByTreatment(
  subtotalFils: number,
  lines: { lineTotal: { toString(): string }; vatTreatment: VatTreatment }[],
): SupplySplit {
  const split: SupplySplit = { STANDARD: 0, ZERO_RATED: 0, EXEMPT: 0, OUT_OF_SCOPE: 0 };
  const byTreatment = { ...split };
  for (const line of lines) byTreatment[line.vatTreatment] += fils(line.lineTotal);
  const linesFils = TREATMENT_ORDER.reduce((sum, t) => sum + byTreatment[t], 0);
  if (linesFils <= 0) {
    split.STANDARD = subtotalFils;
    return split;
  }
  let given = 0;
  const remainders: { treatment: VatTreatment; rest: bigint }[] = [];
  for (const treatment of TREATMENT_ORDER) {
    const exact = BigInt(subtotalFils) * BigInt(byTreatment[treatment]);
    split[treatment] = Number(exact / BigInt(linesFils));
    given += split[treatment];
    remainders.push({ treatment, rest: exact % BigInt(linesFils) });
  }
  remainders.sort((x, y) => (y.rest > x.rest ? 1 : y.rest < x.rest ? -1 : 0));
  for (let i = 0; given < subtotalFils; i += 1, given += 1) {
    split[remainders[i % remainders.length].treatment] += 1;
  }
  return split;
}

/**
 * Splits an invoice's subtotal into its standard-rated and zero-rated parts,
 * in fils, from the lines' rates alone (0% or none is zero-rated).
 */
export function splitSupplies(
  subtotalFils: number,
  lines: { lineTotal: { toString(): string }; taxRate: { toString(): string } | null }[],
) {
  const split = splitByTreatment(
    subtotalFils,
    lines.map((line) => ({
      lineTotal: line.lineTotal,
      vatTreatment: treatmentFromRate(line.taxRate),
    })),
  );
  return { standard: split.STANDARD, zero: split.ZERO_RATED };
}

export async function getVatReturn(user: AuthenticatedUser, input: VatReturnInput = {}) {
  requirePermission(user, 'accounting.view');
  const period: ResolvedPeriod = resolvePeriod({ ...input, period: input.period ?? 'quarter' });
  const organizationId = user.organizationId;
  const branch = user.primaryBranchId ? { branchId: user.primaryBranchId } : {};
  const dates = { gte: parseCalendarDate(period.from)!, lte: parseCalendarDate(period.to)! };

  const [settings, organization, invoices, creditNotes, expenses, receipts] = await Promise.all([
    getVatSettings(organizationId),
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { emirate: true },
    }),
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
        items: { select: { lineTotal: true, vatTreatment: true } },
      },
    }),
    prisma.creditNote.findMany({
      where: { organizationId, ...branch, status: 'ISSUED', issueDate: dates },
      orderBy: [{ issueDate: 'asc' }, { creditNoteNumber: 'asc' }],
      select: {
        id: true,
        creditNoteNumber: true,
        issueDate: true,
        subtotal: true,
        taxAmount: true,
        totalAmount: true,
        reason: true,
        invoice: {
          select: { id: true, invoiceNumber: true, customerName: true, jobCardId: true },
        },
        customer: { select: { name: true, taxNumber: true } },
        items: { select: { lineTotal: true, vatTreatment: true } },
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
        transactionType: { in: ['PURCHASE_RECEIPT', 'RETURN_TO_SUPPLIER'] },
        createdAt: { gte: period.start, lt: period.end },
        purchaseItem: { purchase: { status: { notIn: ['CANCELLED', 'REVERSED'] } } },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        quantity: true,
        unitCost: true,
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

  // ── Sales, less credit notes ────────────────────────────────────────────
  const supplies: SupplySplit = { STANDARD: 0, ZERO_RATED: 0, EXEMPT: 0, OUT_OF_SCOPE: 0 };
  let outputFils = 0;
  const count = (split: SupplySplit, sign: 1 | -1) => {
    for (const treatment of TREATMENT_ORDER) supplies[treatment] += sign * split[treatment];
  };
  const sales = invoices.map((invoice) => {
    const subtotal = fils(invoice.subtotal);
    const split = splitByTreatment(subtotal, invoice.items);
    const vat = fils(invoice.taxAmount);
    count(split, 1);
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
      /** Its share of Box 1, Box 4 and Box 5; out of scope is not reported. */
      standard: filsToString(split.STANDARD),
      zeroRated: filsToString(split.ZERO_RATED),
      exempt: filsToString(split.EXEMPT),
      outOfScope: filsToString(split.OUT_OF_SCOPE),
    };
  });
  const credits = creditNotes.map((note) => {
    const subtotal = fils(note.subtotal);
    const split = splitByTreatment(subtotal, note.items);
    const vat = fils(note.taxAmount);
    count(split, -1);
    outputFils -= vat;
    return {
      id: note.id,
      number: note.creditNoteNumber,
      date: note.issueDate,
      invoiceId: note.invoice.id,
      invoiceNumber: note.invoice.invoiceNumber,
      jobCardId: note.invoice.jobCardId,
      party: note.invoice.customerName ?? note.customer.name,
      taxNumber: note.customer.taxNumber,
      reason: note.reason,
      /** What it takes off the return, as positive figures. */
      net: filsToString(subtotal),
      vat: filsToString(vat),
      total: note.totalAmount.toString(),
      standard: filsToString(split.STANDARD),
      zeroRated: filsToString(split.ZERO_RATED),
      exempt: filsToString(split.EXEMPT),
      outOfScope: filsToString(split.OUT_OF_SCOPE),
    };
  });
  const standardFils = supplies.STANDARD;
  const zeroFils = supplies.ZERO_RATED;
  const exemptFils = supplies.EXEMPT;

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

  // ── Parts received less parts returned, grouped per purchase ────────────
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
    if (!item || qty === 0) continue;
    // Returns carry a negative quantity; priced exactly as the books price them.
    const sign = qty < 0 ? -1 : 1;
    const amounts = calculateLine({
      quantity: milliToString(Math.abs(qty)),
      unitPrice: (receipt.unitCost ?? item.unitCost).toString(),
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
    entry.net += sign * amounts.lineTotalFils;
    entry.vat += sign * amounts.taxFils;
    entry.date = receipt.createdAt;
    byPurchase.set(purchase.id, entry);
  }
  let purchaseNetFils = 0;
  let purchaseVatFils = 0;
  const purchaseRows = [...byPurchase.values()]
    .filter((row) => row.vat !== 0)
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
    /** The emirate the standard-rated supplies are reported against. */
    emirate: { value: organization.emirate, ...EMIRATE_BOX[organization.emirate] },
    boxes: {
      /** Box 1 — standard-rated supplies, less credit notes. */
      standardSupplies: filsToString(registered ? standardFils : 0),
      outputVat: filsToString(output),
      /** Box 4 — zero-rated supplies. */
      zeroRatedSupplies: filsToString(registered ? zeroFils : 0),
      /** Box 5 — exempt supplies. */
      exemptSupplies: filsToString(registered ? exemptFils : 0),
      /** Not reported: out of scope of VAT. */
      outOfScopeSupplies: filsToString(registered ? supplies.OUT_OF_SCOPE : 0),
      /** Box 8 — total supplies. */
      totalSupplies: filsToString(registered ? standardFils + zeroFils + exemptFils : 0),
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
    credits,
    expenses: expenseRows,
    purchases: purchaseRows,
  };
}

export type VatReturn = Awaited<ReturnType<typeof getVatReturn>>;
