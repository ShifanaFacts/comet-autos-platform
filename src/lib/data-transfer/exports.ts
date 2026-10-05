import type { AuthenticatedUser } from '@/lib/auth/session';
import { hasPermission, requirePermission } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { formatMilli } from '@/lib/money';
import { listCustomers } from '@/lib/customers/service';
import { listVehicles } from '@/lib/vehicles/service';
import { listParts, listMovements } from '@/lib/inventory/parts';
import { listSuppliers } from '@/lib/inventory/suppliers';
import { listPurchases } from '@/lib/inventory/purchases';
import { listInvoices, listPayments, PAYMENT_STANDING_LABEL } from '@/lib/billing/lists';
import { listQuotations } from '@/lib/workshop/quotations';
import { listJobCards } from '@/lib/workshop/job-card-list';
import { JOB_STATUS_LABEL } from '@/lib/workshop/stages';
import { ESTIMATE_STATUS_LABEL } from '@/lib/workshop/labels';
import { toCsv, type CsvColumn } from '@/lib/data-transfer/csv';
import { MOVEMENT_LABEL, PURCHASE_STATUS_LABEL } from '@/lib/inventory/labels';
import {
  customerDetails,
  invoiceDetails,
  jobCardDetails,
  movementDetails,
  NO_CUSTOMER_DETAILS,
  NO_INVOICE_DETAILS,
  NO_JOB_CARD_DETAILS,
  NO_MOVEMENT_DETAILS,
  NO_PART_DETAILS,
  NO_PAYMENT_DETAILS,
  NO_PURCHASE_DETAILS,
  NO_QUOTATION_DETAILS,
  NO_VEHICLE_DETAILS,
  partDetails,
  paymentDetails,
  purchaseDetails,
  quotationDetails,
  vehicleDetails,
  withDetails,
} from '@/lib/data-transfer/export-details';

/*
 * Every list, as a spreadsheet.
 *
 * Each export runs the same service the screen runs, with the same search
 * and filters, so what downloads is what was on screen — only without the
 * page limit. Two permission checks: the module's Export permission, and
 * the service's own View check — someone who cannot see a list cannot
 * export it either.
 *
 * Amounts are written as plain decimal strings ("1250.00") so a spreadsheet
 * reads them as numbers; dates as ISO so they sort.
 */

/** The most rows one download will produce, so a huge table can't exhaust memory. */
export const EXPORT_LIMIT = 20000;

export interface ExportFilters {
  q?: string;
  status?: string;
  stock?: string;
  category?: string;
  supplierId?: string;
  partId?: string;
  type?: string;
}

interface ExportDefinition<Row> {
  /** The module's export permission, on top of the list's own view check. */
  permission: string;
  /** Shown in the file name. */
  label: string;
  /** What the file holds — one row per what, and which rows — for the guide shown before download. */
  description: string;
  load: (user: AuthenticatedUser, filters: ExportFilters) => Promise<Row[]>;
  columns: CsvColumn<Row>[];
}

const date = (value: Date | null | undefined) => (value ? value.toISOString().slice(0, 10) : '');
const dateTime = (value: Date | null | undefined) => (value ? value.toISOString() : '');
const money = (value: { toString(): string } | null | undefined) =>
  value === null || value === undefined || value.toString() === ''
    ? ''
    : Number(value.toString()).toFixed(2);
const yesNo = (value: boolean) => (value ? 'Yes' : 'No');

function definition<Row>(definition: ExportDefinition<Row>): ExportDefinition<unknown> {
  return definition as unknown as ExportDefinition<unknown>;
}

/** Shared wording for the guide. */
const AMOUNTS =
  'Amounts are in AED as plain numbers (1250.00), so the spreadsheet can add them up.';
const DATES = 'Dates are written YYYY-MM-DD (times in UTC) so they sort correctly.';

/**
 * The lists that can be downloaded. Adding one here is all a new list needs
 * — the route, the button and the guide read this registry.
 */
export const EXPORTS: Record<string, ExportDefinition<unknown>> = {
  customers: definition({
    permission: 'customer.export',
    label: 'Customers',
    description: `One row per customer on the list, with their vehicles and what they have been invoiced, paid and still owe. ${AMOUNTS}`,
    load: async (user, filters) =>
      withDetails(
        await listCustomers(user, filters.q ?? '', EXPORT_LIMIT),
        (ids) => customerDetails(user.organizationId, ids),
        NO_CUSTOMER_DETAILS,
      ),
    columns: [
      { header: 'Name', value: (row) => row.name },
      { header: 'Mobile', value: (row) => row.phone },
      { header: 'Email', value: (row) => row.email },
      { header: 'Address', value: (row) => row.details.address },
      {
        header: 'TRN',
        value: (row) => row.details.taxNumber,
        hint: 'The customer’s VAT registration number, for business customers.',
      },
      {
        header: 'Customer code',
        value: (row) => row.details.code,
        hint: 'The code from your old system, when one was imported.',
      },
      {
        header: 'Vehicles',
        value: (row) => row.vehicles.map((v) => v.plateNumber).join(' / '),
        hint: 'Registrations of the vehicles on file, separated by /.',
      },
      {
        header: 'Vehicle details',
        value: (row) => row.vehicles.map((v) => `${v.make} ${v.model}`).join(' / '),
      },
      {
        header: 'Number of vehicles',
        value: (row) => row.vehicles.length,
      },
      {
        header: 'Job cards',
        value: (row) => row.details.jobCards,
        hint: 'Every visit, open or finished.',
      },
      {
        header: 'Last visit',
        value: (row) => date(row.details.lastVisit),
        hint: 'When the latest job card was opened.',
      },
      {
        header: 'Invoices',
        value: (row) => row.details.invoices,
        hint: 'Issued invoices (drafts and void ones are not counted).',
      },
      {
        header: 'Total invoiced',
        value: (row) => money(row.details.invoiced),
        hint: 'All issued invoices, VAT included.',
      },
      {
        header: 'Paid',
        value: (row) => money(row.details.paid),
        hint: 'Payments received against those invoices.',
      },
      {
        header: 'Balance owed',
        value: (row) => money(row.details.owed),
        hint: 'Still due after payments, credit notes, discounts and advances applied.',
      },
      {
        header: 'Added',
        value: (row) => date(row.createdAt),
        hint: 'When the customer was first entered.',
      },
    ],
  }),

  vehicles: definition({
    permission: 'vehicle.export',
    label: 'Vehicles',
    description: 'One row per vehicle on the list, with its owner and how often it has been in.',
    load: async (user, filters) =>
      withDetails(
        await listVehicles(user, filters.q ?? '', EXPORT_LIMIT),
        (ids) => vehicleDetails(user.organizationId, ids),
        NO_VEHICLE_DETAILS,
      ),
    columns: [
      { header: 'Registration', value: (row) => row.plateNumber },
      { header: 'Emirate', value: (row) => row.plateEmirate },
      { header: 'Make', value: (row) => row.make },
      { header: 'Model', value: (row) => row.model },
      { header: 'Year', value: (row) => row.year },
      { header: 'VIN', value: (row) => row.vin, hint: 'Chassis number.' },
      { header: 'Colour', value: (row) => row.color },
      {
        header: 'Last mileage (km)',
        value: (row) => row.lastMileage,
        hint: 'The odometer at the latest check-in.',
      },
      { header: 'Customer', value: (row) => row.customer.name, hint: 'The current owner.' },
      { header: 'Customer mobile', value: (row) => row.customer.phone },
      {
        header: 'Job cards',
        value: (row) => row.details.jobCards,
        hint: 'Every visit, open or finished.',
      },
      { header: 'Last visit', value: (row) => date(row.details.lastVisit) },
      { header: 'Added', value: (row) => date(row.details.added) },
    ],
  }),

  parts: definition({
    permission: 'inventory.export',
    label: 'Parts',
    description: `One row per part on the list (with the screen's search and filters), with stock on hand and its value at cost. ${AMOUNTS}`,
    load: async (user, filters) =>
      withDetails(
        (
          await listParts(user, {
            q: filters.q,
            category: filters.category,
            supplierId: filters.supplierId,
            stock: filters.stock as never,
            status: filters.status as never,
          })
        ).parts,
        (ids) => partDetails(user.organizationId, ids),
        NO_PART_DETAILS,
      ),
    columns: [
      { header: 'SKU', value: (row) => row.sku, hint: 'The part number or code.' },
      { header: 'Name', value: (row) => row.name },
      { header: 'Description', value: (row) => row.details.description },
      { header: 'Category', value: (row) => row.category },
      {
        header: 'Unit',
        value: (row) => row.unitOfMeasure,
        hint: 'What one is counted in: piece, litre, set…',
      },
      {
        header: 'Cost price',
        value: (row) => money(row.defaultCostPrice),
        hint: 'The last price paid to the supplier per unit, before VAT.',
      },
      {
        header: 'Selling price',
        value: (row) => money(row.defaultSellingPrice),
        hint: 'The price charged per unit, before VAT.',
      },
      { header: 'VAT %', value: (row) => money(row.defaultTaxRate) },
      {
        header: 'On hand',
        value: (row) => formatMilli(row.onHandMilli),
        hint: 'Stock now, from every receipt, sale, return and adjustment.',
      },
      {
        header: 'Stock value at cost',
        value: (row) =>
          row.defaultCostPrice
            ? ((row.onHandMilli / 1000) * Number(row.defaultCostPrice.toString())).toFixed(2)
            : '',
        hint: 'On hand × cost price.',
      },
      {
        header: 'Reorder level',
        value: (row) => row.reorderLevel,
        hint: 'Below this the part shows as low stock.',
      },
      { header: 'Stock state', value: (row) => STOCK_STATE[row.state] ?? row.state },
      { header: 'Preferred supplier', value: (row) => row.preferredSupplier?.name ?? '' },
      {
        header: 'Active',
        value: (row) => yesNo(row.isActive),
        hint: 'No: archived, kept for history.',
      },
    ],
  }),

  suppliers: definition({
    permission: 'inventory.export',
    label: 'Suppliers',
    description: `One row per supplier on the list, with what has been received from them, paid and still owed. ${AMOUNTS}`,
    load: (user, filters) => listSuppliers(user, filters.q ?? ''),
    columns: [
      { header: 'Name', value: (row) => row.name },
      {
        header: 'TRN',
        value: (row) => row.taxNumber,
        hint: 'The supplier’s VAT registration number.',
      },
      { header: 'Contact name', value: (row) => row.contactName },
      { header: 'Mobile', value: (row) => row.phone },
      { header: 'Email', value: (row) => row.email },
      { header: 'Address', value: (row) => row.address },
      {
        header: 'Parts supplied',
        value: (row) => row._count.parts,
        hint: 'Parts that name this supplier as preferred.',
      },
      {
        header: 'Purchases',
        value: (row) => row._count.purchases,
        hint: 'Every purchase, any status.',
      },
      {
        header: 'Total received',
        value: (row) => money(row.balance.received),
        hint: 'Goods received, VAT included — what was owed before payments.',
      },
      { header: 'Paid', value: (row) => money(row.balance.paid) },
      {
        header: 'Balance owed',
        value: (row) => money(row.balance.outstanding),
        hint: 'Total received less paid.',
      },
      { header: 'Last purchase', value: (row) => date(row.lastPurchaseAt) },
      { header: 'Active', value: (row) => yesNo(row.isActive) },
    ],
  }),

  'work-orders': definition({
    permission: 'job_card.export',
    label: 'Job cards',
    description: `One row per job card on the list (with the screen's search and status filter): the visit, the quotation and the invoice behind it. ${AMOUNTS} ${DATES}`,
    load: async (user, filters) =>
      withDetails(
        await listJobCards(user, { q: filters.q, status: filters.status }, EXPORT_LIMIT),
        (ids) => jobCardDetails(user.organizationId, ids),
        NO_JOB_CARD_DETAILS,
      ),
    columns: [
      { header: 'Job card', value: (row) => row.jobNumber },
      { header: 'Status', value: (row) => JOB_STATUS_LABEL[row.status] },
      { header: 'Customer', value: (row) => row.customer.name },
      { header: 'Mobile', value: (row) => row.customer.phone },
      { header: 'Registration', value: (row) => row.vehicle.plateNumber },
      { header: 'Vehicle', value: (row) => `${row.vehicle.make} ${row.vehicle.model}` },
      {
        header: 'Mileage (km)',
        value: (row) => row.odometerReading,
        hint: 'The odometer at check-in.',
      },
      {
        header: 'Work requested',
        value: (row) => row.customerComplaint,
        hint: 'The customer’s complaint, as written at check-in.',
      },
      {
        header: 'Received by',
        value: (row) => row.details.receivedBy,
        hint: 'Who opened the job card.',
      },
      { header: 'Technician', value: (row) => row.details.technician },
      {
        header: 'Quotations',
        value: (row) => row.details.quotations,
        hint: 'The current quotation, and any additional work, that was sent.',
      },
      {
        header: 'Quoted total',
        value: (row) => money(row.details.quotationTotal),
        hint: 'Those quotations added up, VAT included.',
      },
      { header: 'Invoice', value: (row) => row.details.invoice },
      {
        header: 'Invoice total',
        value: (row) => money(row.details.invoiceTotal),
        hint: 'VAT included.',
      },
      { header: 'Paid', value: (row) => money(row.details.paid) },
      { header: 'Balance due', value: (row) => money(row.details.balance) },
      { header: 'Opened', value: (row) => dateTime(row.openedAt) },
      {
        header: 'Closed',
        value: (row) => dateTime(row.closedAt),
        hint: 'When the work was finished.',
      },
      {
        header: 'Delivered',
        value: (row) => dateTime(row.details.delivered),
        hint: 'When the vehicle was handed back.',
      },
      { header: 'Delivered by', value: (row) => row.details.deliveredBy },
    ],
  }),

  quotations: definition({
    permission: 'quotation.export',
    label: 'Quotations',
    description: `One row per quotation version on the list, with its amounts and the customer's decision. ${AMOUNTS} ${DATES}`,
    load: async (user, filters) =>
      withDetails(
        (await listQuotations(user, { q: filters.q, status: filters.status }, EXPORT_LIMIT))
          .quotations,
        (ids) => quotationDetails(user.organizationId, ids),
        NO_QUOTATION_DETAILS,
      ),
    columns: [
      { header: 'Quotation', value: (row) => row.estimateNumber },
      {
        header: 'Version',
        value: (row) => row.version,
        hint: 'A revised quotation keeps its number with a new version.',
      },
      {
        header: 'Type',
        value: (row) => row.details.kind,
        hint: 'Original, or additional work found during the repair.',
      },
      {
        header: 'Status',
        value: (row) => (row.expired ? 'Expired' : ESTIMATE_STATUS_LABEL[row.status]),
      },
      { header: 'Customer', value: (row) => row.customer.name },
      { header: 'Mobile', value: (row) => row.customer.phone },
      { header: 'Registration', value: (row) => row.vehicle?.plateNumber ?? '' },
      { header: 'Vehicle', value: (row) => row.details.vehicle },
      { header: 'Job card', value: (row) => row.jobCard?.jobNumber ?? '' },
      {
        header: 'Discount',
        value: (row) => money(row.details.discount),
        hint: 'Line and whole-bill discounts, before VAT.',
      },
      { header: 'Total excl. VAT', value: (row) => money(row.details.subtotal) },
      { header: 'VAT', value: (row) => money(row.details.vat) },
      { header: 'Total', value: (row) => money(row.totalAmount), hint: 'VAT included.' },
      {
        header: 'Decision',
        value: (row) => row.details.decision,
        hint: 'The customer’s answer: approved, partly approved or declined.',
      },
      { header: 'Decided', value: (row) => dateTime(row.details.decidedAt) },
      { header: 'Valid until', value: (row) => date(row.validUntil) },
      { header: 'Sent', value: (row) => dateTime(row.sentAt) },
      { header: 'Prepared by', value: (row) => row.details.preparedBy },
      { header: 'Created', value: (row) => dateTime(row.createdAt) },
    ],
  }),

  invoices: definition({
    permission: 'invoice.export',
    label: 'Invoices',
    description: `One row per tax invoice on the list (with the screen's search and filter), with VAT, every reduction and what is still due. ${AMOUNTS} ${DATES}`,
    load: async (user, filters) =>
      withDetails(
        (await listInvoices(user, { q: filters.q, status: filters.status }, EXPORT_LIMIT)).invoices,
        (ids) => invoiceDetails(user.organizationId, ids),
        NO_INVOICE_DETAILS,
      ),
    columns: [
      { header: 'Invoice', value: (row) => row.invoiceNumber },
      { header: 'Status', value: (row) => row.details.status },
      { header: 'Issue date', value: (row) => date(row.issueDate) },
      { header: 'Due date', value: (row) => date(row.dueDate) },
      {
        header: 'Customer',
        value: (row) => row.customerName ?? row.customer.name,
        hint: 'As printed on the invoice.',
      },
      {
        header: 'Customer TRN',
        value: (row) => row.details.customerTaxNumber,
        hint: 'As printed on the invoice.',
      },
      { header: 'Mobile', value: (row) => row.customer.phone },
      {
        header: "Customer's order no.",
        value: (row) => row.customerReference ?? '',
        hint: 'Their LPO or reference, when given.',
      },
      { header: 'Registration', value: (row) => row.vehicle?.plateNumber ?? '' },
      { header: 'Vehicle', value: (row) => row.details.vehicle },
      { header: 'Job card', value: (row) => row.jobCard?.jobNumber ?? '' },
      {
        header: 'Discount',
        value: (row) => money(row.totalDiscount),
        hint: 'Line and whole-bill discounts given on the invoice, before VAT.',
      },
      {
        header: 'Total excl. VAT',
        value: (row) => money(row.subtotal),
        hint: 'Taxable amount, after those discounts.',
      },
      { header: 'VAT', value: (row) => money(row.taxAmount), hint: 'Output VAT on the invoice.' },
      {
        header: 'Round-off',
        value: (row) => money(row.details.roundOff),
        hint: 'Rounding after VAT, when used.',
      },
      {
        header: 'Total',
        value: (row) => money(row.balance.total),
        hint: 'The invoice total, VAT included.',
      },
      {
        header: 'Credited',
        value: (row) => money(row.details.credited),
        hint: 'Taken back by credit notes.',
      },
      {
        header: 'Discount after invoice',
        value: (row) => money(row.details.discountAfter),
        hint: 'A settlement discount given later (VAT unchanged).',
      },
      {
        header: 'Advance applied',
        value: (row) => money(row.details.advanceApplied),
        hint: 'Paid from the customer’s advance.',
      },
      {
        header: 'Paid',
        value: (row) => money(row.balance.paid),
        hint: 'Payments received (reversed payments are not counted).',
      },
      {
        header: 'Balance due',
        value: (row) => money(row.balance.balance),
        hint: 'Total − credited − discount after − advance − paid.',
      },
      {
        header: 'Payment state',
        value: (row) => PAYMENT_STATE[row.balance.state] ?? row.balance.state,
      },
      { header: 'Last payment', value: (row) => date(row.details.lastPayment) },
      { header: 'Issued by', value: (row) => row.details.issuedBy },
      { header: 'Notes', value: (row) => row.details.notes },
      {
        header: 'Void reason',
        value: (row) => row.details.voidReason,
        hint: 'Only for a voided invoice.',
      },
    ],
  }),

  payments: definition({
    permission: 'payment.export',
    label: 'Payments',
    description: `One row per receipt — money received from a customer — and one per reversal of a receipt. Reversals are negative, so the Amount column adds up to the money that stands. ${AMOUNTS} ${DATES}`,
    load: async (user, filters) =>
      withDetails(
        (await listPayments(user, { q: filters.q, view: 'all' }, EXPORT_LIMIT)).payments,
        (ids) => paymentDetails(user.organizationId, ids),
        NO_PAYMENT_DETAILS,
      ),
    columns: [
      { header: 'Receipt', value: (row) => row.paymentNumber },
      { header: 'Received', value: (row) => dateTime(row.receivedAt) },
      {
        header: 'Standing',
        value: (row) => PAYMENT_STANDING_LABEL[row.standing],
        hint: 'Counts, reversed, or the reversal itself.',
      },
      {
        header: 'Amount',
        value: (row) => money(row.signedAmount),
        hint: 'Negative for a reversal.',
      },
      { header: 'Method', value: (row) => row.methodLabel },
      {
        header: 'Paid into',
        value: (row) => row.details.account,
        hint: 'The cash, bank or card account the money went to.',
      },
      {
        header: 'Reference',
        value: (row) => row.referenceNumber,
        hint: 'Transfer, cheque or card-slip number.',
      },
      { header: 'Invoice', value: (row) => row.invoice.invoiceNumber },
      { header: 'Customer', value: (row) => row.invoice.customerName },
      { header: 'Customer mobile', value: (row) => row.details.customerMobile },
      { header: 'Registration', value: (row) => row.details.registration },
      { header: 'Job card', value: (row) => row.invoice.jobCard?.jobNumber ?? '' },
      { header: 'Received by', value: (row) => row.receivedBy.fullName },
      { header: 'Reversal of', value: (row) => row.reversalOf?.paymentNumber ?? '' },
      { header: 'Reversal reason', value: (row) => (row.standing === 'REVERSAL' ? row.notes : '') },
    ],
  }),

  purchases: definition({
    permission: 'purchase.export',
    label: 'Purchases',
    description: `One row per purchase (supplier bill) on the list, with VAT, discount, round-off and what is still owed. Drafts and cancelled purchases owe nothing. ${AMOUNTS} ${DATES}`,
    load: async (user, filters) =>
      withDetails(
        (
          await listPurchases(
            user,
            { q: filters.q, status: filters.status, supplierId: filters.supplierId },
            EXPORT_LIMIT,
          )
        ).purchases,
        (ids) => purchaseDetails(user.organizationId, ids),
        NO_PURCHASE_DETAILS,
      ),
    columns: [
      { header: 'Purchase', value: (row) => row.purchaseNumber },
      { header: 'Status', value: (row) => PURCHASE_STATUS_LABEL[row.status] ?? row.status },
      { header: 'Supplier', value: (row) => row.supplier.name },
      { header: 'Supplier TRN', value: (row) => row.details.supplierTaxNumber },
      {
        header: 'Supplier invoice',
        value: (row) => row.supplierInvoiceNumber,
        hint: 'Their bill number.',
      },
      { header: 'Supplier invoice date', value: (row) => date(row.supplierInvoiceDate) },
      {
        header: 'Due date',
        value: (row) => date(row.details.dueDate),
        hint: 'When the supplier expects payment.',
      },
      { header: 'Lines', value: (row) => row._count.items },
      {
        header: 'Discount',
        value: (row) => money(row.details.discount),
        hint: 'Whole-bill discount from the supplier, before VAT.',
      },
      { header: 'Total excl. VAT', value: (row) => money(row.subtotal) },
      {
        header: 'VAT',
        value: (row) => money(row.taxAmount),
        hint: 'Input VAT you can claim back.',
      },
      {
        header: 'Round-off',
        value: (row) => money(row.details.roundOff),
        hint: 'The supplier’s adjustment after VAT, when used.',
      },
      {
        header: 'Total',
        value: (row) => money(row.totalAmount),
        hint: 'The bill total, VAT included.',
      },
      {
        header: 'Received value',
        value: (row) => money(row.details.received),
        hint: 'What was owed for the goods actually received.',
      },
      { header: 'Paid', value: (row) => money(row.details.paid) },
      { header: 'Balance owed', value: (row) => money(row.details.owed) },
      { header: 'Ordered', value: (row) => dateTime(row.orderedAt) },
      {
        header: 'Received',
        value: (row) => dateTime(row.receivedAt),
        hint: 'When the stock came in.',
      },
      { header: 'Entered by', value: (row) => row.details.createdBy },
      { header: 'Received by', value: (row) => row.details.receivedBy },
      { header: 'Notes', value: (row) => row.details.notes },
    ],
  }),

  'stock-movements': definition({
    permission: 'inventory.export',
    label: 'Stock movements',
    description: `One row per stock movement on the list — every unit in or out: purchases received, parts used on jobs, returns and adjustments. In is positive, out is negative. ${AMOUNTS} ${DATES}`,
    load: async (user, filters) =>
      withDetails(
        (await listMovements(user, { q: filters.q, type: filters.type }, EXPORT_LIMIT)).movements,
        (ids) => movementDetails(user.organizationId, ids),
        NO_MOVEMENT_DETAILS,
      ),
    columns: [
      { header: 'When', value: (row) => dateTime(row.createdAt) },
      {
        header: 'Type',
        value: (row) => MOVEMENT_LABEL[row.transactionType] ?? row.transactionType,
      },
      { header: 'SKU', value: (row) => row.part.sku },
      { header: 'Part', value: (row) => row.part.name },
      { header: 'Unit', value: (row) => row.part.unitOfMeasure },
      {
        header: 'Quantity',
        value: (row) => formatMilli(row.quantityMilli),
        hint: 'Positive in, negative out.',
      },
      {
        header: 'Unit cost',
        value: (row) => money(row.unitCost),
        hint: 'Cost per unit, before VAT.',
      },
      {
        header: 'Value',
        value: (row) =>
          row.unitCost
            ? ((row.quantityMilli / 1000) * Number(row.unitCost.toString())).toFixed(2)
            : '',
        hint: 'Quantity × unit cost.',
      },
      {
        header: 'Reference',
        value: (row) => row.details.reference,
        hint: 'The purchase and supplier, or the job card.',
      },
      { header: 'Note', value: (row) => row.note },
      { header: 'By', value: (row) => row.performedBy?.fullName ?? '' },
    ],
  }),
};

const STOCK_STATE: Record<string, string> = {
  IN_STOCK: 'In stock',
  LOW: 'Low',
  OUT: 'Out of stock',
};

const PAYMENT_STATE: Record<string, string> = {
  UNPAID: 'Unpaid',
  PARTIALLY_PAID: 'Partly paid',
  PAID: 'Paid',
};

/** What an export holds and what every column means — shown before the file downloads. */
export interface ExportGuide {
  label: string;
  description: string;
  columns: { header: string; hint: string | null }[];
}

export function exportGuide(entity: string): ExportGuide | null {
  const definition = EXPORTS[entity];
  if (!definition) return null;
  return {
    label: definition.label,
    description: definition.description,
    columns: definition.columns.map((column) => ({
      header: column.header,
      hint: column.hint ?? null,
    })),
  };
}

export type ExportEntity = keyof typeof EXPORTS;

export function isExportEntity(entity: string): entity is string {
  return Object.hasOwn(EXPORTS, entity);
}

/** Whether this user may download the list: its module's Export permission. */
export function canExport(user: AuthenticatedUser, entity: string) {
  const definition = EXPORTS[entity];
  return Boolean(definition) && hasPermission(user, definition.permission);
}

/**
 * Runs the export and returns the file's text. Two checks: the module's
 * Export permission here, and the list service's own view check.
 */
export async function buildExport(
  user: AuthenticatedUser,
  entity: string,
  filters: ExportFilters,
): Promise<{ csv: string; label: string; rows: number }> {
  const definition = EXPORTS[entity];
  if (!definition) throw new NotFoundError('export');
  requirePermission(user, definition.permission);
  const rows = await definition.load(user, filters);
  return { csv: toCsv(rows, definition.columns), label: definition.label, rows: rows.length };
}
