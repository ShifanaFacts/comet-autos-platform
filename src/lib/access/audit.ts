import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { PERMISSION_MODULES } from '@/lib/auth/permission-catalog';
import {
  endOfLocalDay,
  formatMoney,
  localDayRange,
  parseCalendarDate,
  toLocalDateTimeInput,
} from '@/lib/format';
import { toCsv } from '@/lib/data-transfer/csv';

/*
 * Reading the audit log.
 *
 * Every state-changing action already writes a row, in the same transaction
 * as the change (`lib/audit`). This module only reads them back — there is
 * no function anywhere that edits or deletes one, and the database refuses
 * both (the `audit_logs_permanent` trigger), so the log is read-only for
 * everyone, the application included.
 *
 * Rows are stored as facts (who, what, which record, before and after);
 * the plain-English sentence and the link are worked out here when read,
 * so improving the wording never means rewriting history.
 */

export const AUDIT_PAGE_SIZE = 50;
const EXPORT_LIMIT = 20000;

// ─── What an action is ──────────────────────────────────────────────────────

/** Action prefix → the catalogue module it belongs to. */
const PREFIX_MODULE: Record<string, string> = {
  job_card: 'job_card',
  job_photo: 'job_card',
  inspection: 'job_card',
  diagnosis: 'job_card',
  repair: 'job_card',
  labour: 'job_card',
  part_usage: 'job_card',
  signature: 'job_card',
  estimate: 'quotation',
  quotation: 'quotation',
  appointment: 'appointment',
  customer: 'customer',
  vehicle: 'vehicle',
  part: 'inventory',
  supplier: 'inventory',
  inventory: 'inventory',
  purchase: 'purchase',
  supplier_payment: 'supplier_payment',
  invoice: 'invoice',
  payment: 'payment',
  credit_note: 'credit_note',
  expense: 'expense',
  journal: 'accounting',
  account: 'accounting',
  accounts: 'accounting',
  books: 'accounting',
  opening_balances: 'accounting',
  fixed_asset: 'accounting',
  bank_reconciliation: 'accounting',
  vat: 'vat',
  employee: 'employee',
  attendance: 'attendance',
  leave: 'leave',
  payroll: 'payroll',
  salary: 'payroll',
  organization: 'settings',
  branch: 'settings',
  tax_code: 'settings',
  payment_mode: 'settings',
  user: 'user',
  role: 'role',
};

/** For prefixes shared between modules (a customer link to a quote or an invoice). */
const ENTITY_MODULE: Record<string, string> = {
  Estimate: 'quotation',
  Invoice: 'invoice',
  JobCard: 'job_card',
};

export function auditModule(action: string, entityType: string): string | null {
  return PREFIX_MODULE[action.split('.')[0]] ?? ENTITY_MODULE[entityType] ?? null;
}

const DELETE_SUFFIXES = [
  'reversed',
  'voided',
  'cancelled',
  'deleted',
  'archived',
  'removed',
  'discarded',
  'draft_deleted',
  'bill_removed',
  'merged_away',
];
const APPROVE_SUFFIXES = [
  'approved',
  'rejected',
  'paid',
  'filed',
  'settled',
  'closed',
  'year_closed',
  'completed',
  'delivered',
  'received',
  'refunded',
  'technician_assigned',
];
const CREATE_SUFFIXES = [
  'created',
  'recorded',
  'issued',
  'imported',
  'added',
  'customer_added',
  'standard_added',
  'uploaded',
  'requested',
  'captured',
  'started',
  'calculated',
  'duplicated',
  'clocked_in',
  'clocked_out',
  'marked',
  'set',
  'bill_attached',
  'filled_from_scan',
  'link_shared',
  'sent',
];

export const AUDIT_TYPES = [
  { key: 'create', label: 'Added' },
  { key: 'change', label: 'Changed' },
  { key: 'delete', label: 'Deleted, voided, cancelled or reversed' },
  { key: 'approve', label: 'Approvals & sign-offs' },
  { key: 'sensitive', label: 'Sensitive only' },
] as const;
export type AuditType = (typeof AUDIT_TYPES)[number]['key'];

const suffixOf = (action: string) => action.slice(action.indexOf('.') + 1);

/**
 * The actions an accountant should be able to spot at a glance: anything
 * that takes money or records back, the credit notes and manual journals
 * that change the books by hand, merges, and every change to who can do
 * what.
 */
export function isSensitive(action: string): boolean {
  const [prefix] = action.split('.');
  const suffix = suffixOf(action);
  return (
    DELETE_SUFFIXES.includes(suffix) ||
    prefix === 'credit_note' ||
    action === 'journal.created' ||
    action.startsWith('customer.merged') ||
    action === 'books.reopened' ||
    action === 'books.year_reopened' ||
    prefix === 'role' ||
    prefix === 'user'
  );
}

function typeWhere(type: AuditType): Prisma.AuditLogWhereInput {
  const endsIn = (suffixes: string[]) =>
    suffixes.map((suffix) => ({ action: { endsWith: `.${suffix}` } }));
  switch (type) {
    case 'create':
      return { OR: endsIn(CREATE_SUFFIXES) };
    case 'delete':
      return { OR: endsIn(DELETE_SUFFIXES) };
    case 'approve':
      return { OR: endsIn(APPROVE_SUFFIXES) };
    case 'change':
      return {
        NOT: { OR: endsIn([...CREATE_SUFFIXES, ...DELETE_SUFFIXES, ...APPROVE_SUFFIXES]) },
      };
    case 'sensitive':
      return {
        OR: [
          ...endsIn(DELETE_SUFFIXES),
          { action: { startsWith: 'credit_note.' } },
          { action: 'journal.created' },
          { action: { startsWith: 'customer.merged' } },
          { action: { in: ['books.reopened', 'books.year_reopened'] } },
          { action: { startsWith: 'role.' } },
          { action: { startsWith: 'user.' } },
        ],
      };
  }
}

function moduleWhere(module: string): Prisma.AuditLogWhereInput {
  const prefixes = Object.entries(PREFIX_MODULE)
    .filter(([, key]) => key === module)
    .map(([prefix]) => ({ action: { startsWith: `${prefix}.` } }));
  const entities = Object.entries(ENTITY_MODULE)
    .filter(([, key]) => key === module)
    .map(([entity]) => entity);
  return {
    OR: [
      ...prefixes,
      ...(entities.length > 0
        ? [{ action: { startsWith: 'customer_access.' }, entityType: { in: entities } }]
        : []),
    ],
  };
}

// ─── Filters ────────────────────────────────────────────────────────────────

export interface AuditFilters {
  from?: string;
  to?: string;
  who?: string;
  module?: string;
  type?: string;
  page?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildWhere(user: AuthenticatedUser, filters: AuditFilters): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [{ organizationId: user.organizationId }];
  const from = filters.from ? parseCalendarDate(filters.from) : null;
  const to = filters.to ? parseCalendarDate(filters.to) : null;
  if (from) and.push({ createdAt: { gte: localDayRange(from).start } });
  if (to) and.push({ createdAt: { lte: endOfLocalDay(to) } });
  if (filters.who && UUID.test(filters.who)) and.push({ actorUserId: filters.who });
  if (filters.module && PERMISSION_MODULES.some((module) => module.key === filters.module)) {
    and.push(moduleWhere(filters.module));
  }
  const type = AUDIT_TYPES.find((option) => option.key === filters.type)?.key;
  if (type) and.push(typeWhere(type));
  return { AND: and };
}

// ─── Records the entries point at ──────────────────────────────────────────

interface Target {
  /** How the record is known: a number, or a name. */
  ref: string | null;
  amount?: string | null;
  href?: string | null;
}

type Resolver = (organizationId: string, ids: string[]) => Promise<Map<string, Target>>;

const byId = <Row extends { id: string }>(rows: Row[], make: (row: Row) => Target) =>
  new Map(rows.map((row) => [row.id, make(row)]));

const RESOLVERS: Record<string, Resolver> = {
  Invoice: async (organizationId, ids) =>
    byId(
      await prisma.invoice.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, invoiceNumber: true, totalAmount: true },
      }),
      (row) => ({
        ref: row.invoiceNumber,
        amount: row.totalAmount?.toString() ?? null,
        href: `/finance/invoices/${row.id}`,
      }),
    ),
  Payment: async (organizationId, ids) =>
    byId(
      await prisma.payment.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, paymentNumber: true, amount: true, invoiceId: true },
      }),
      (row) => ({
        ref: row.paymentNumber,
        amount: row.amount.toString(),
        href: `/finance/invoices/${row.invoiceId}`,
      }),
    ),
  JobCard: async (organizationId, ids) =>
    byId(
      await prisma.jobCard.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, jobNumber: true },
      }),
      (row) => ({ ref: row.jobNumber, href: `/job-cards/${row.id}` }),
    ),
  Estimate: async (organizationId, ids) =>
    byId(
      await prisma.estimate.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, estimateNumber: true, totalAmount: true },
      }),
      (row) => ({
        ref: row.estimateNumber,
        amount: row.totalAmount?.toString() ?? null,
        href: `/quotations/${row.id}`,
      }),
    ),
  CreditNote: async (organizationId, ids) =>
    byId(
      await prisma.creditNote.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, creditNoteNumber: true, totalAmount: true },
      }),
      (row) => ({
        ref: row.creditNoteNumber,
        amount: row.totalAmount?.toString() ?? null,
        href: `/finance/credit-notes/${row.id}`,
      }),
    ),
  Purchase: async (organizationId, ids) =>
    byId(
      await prisma.purchase.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, purchaseNumber: true, totalAmount: true },
      }),
      (row) => ({
        ref: row.purchaseNumber,
        amount: row.totalAmount?.toString() ?? null,
        href: `/inventory/purchases/${row.id}`,
      }),
    ),
  Expense: async (organizationId, ids) =>
    byId(
      await prisma.expense.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, expenseNumber: true, amount: true },
      }),
      (row) => ({
        ref: row.expenseNumber,
        amount: row.amount.toString(),
        href: row.expenseNumber
          ? `/finance/expenses?q=${encodeURIComponent(row.expenseNumber)}`
          : '/finance/expenses',
      }),
    ),
  JournalEntry: async (organizationId, ids) =>
    byId(
      await prisma.journalEntry.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, entryNumber: true },
      }),
      (row) => ({ ref: row.entryNumber, href: '/finance/accounting?view=journal' }),
    ),
  SupplierPayment: async (organizationId, ids) =>
    byId(
      await prisma.supplierPayment.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, supplierPaymentNumber: true, amount: true },
      }),
      (row) => ({
        ref: row.supplierPaymentNumber,
        amount: row.amount.toString(),
        href: '/finance/payables',
      }),
    ),
  Customer: async (organizationId, ids) =>
    byId(
      await prisma.customer.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, name: true },
      }),
      (row) => ({ ref: row.name, href: `/customers/${row.id}` }),
    ),
  Vehicle: async (organizationId, ids) =>
    byId(
      await prisma.vehicle.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, plateNumber: true },
      }),
      (row) => ({ ref: row.plateNumber, href: `/vehicles/${row.id}` }),
    ),
  Part: async (organizationId, ids) =>
    byId(
      await prisma.part.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, name: true },
      }),
      (row) => ({ ref: row.name, href: `/inventory/parts/${row.id}` }),
    ),
  Supplier: async (organizationId, ids) =>
    byId(
      await prisma.supplier.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, name: true },
      }),
      (row) => ({ ref: row.name, href: `/inventory/suppliers/${row.id}` }),
    ),
  Employee: async (organizationId, ids) =>
    byId(
      await prisma.employee.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, firstName: true, lastName: true },
      }),
      (row) => ({ ref: `${row.firstName} ${row.lastName}`, href: `/hr/employees/${row.id}` }),
    ),
  User: async (organizationId, ids) =>
    byId(
      await prisma.user.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, fullName: true },
      }),
      (row) => ({ ref: row.fullName, href: `/settings/users/${row.id}` }),
    ),
  Role: async (organizationId, ids) =>
    byId(
      await prisma.role.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, name: true },
      }),
      (row) => ({ ref: row.name, href: `/settings/roles/${row.id}` }),
    ),
  FixedAsset: async (organizationId, ids) =>
    byId(
      await prisma.fixedAsset.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, assetNumber: true, name: true },
      }),
      (row) => ({
        ref: [row.assetNumber, row.name].filter(Boolean).join(' '),
        href: `/finance/fixed-assets/${row.id}`,
      }),
    ),
  ChartOfAccount: async (organizationId, ids) =>
    byId(
      await prisma.chartOfAccount.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, accountName: true },
      }),
      (row) => ({
        ref: row.accountName,
        href: `/finance/accounting?view=ledger&account=${row.id}`,
      }),
    ),
  Payroll: async (organizationId, ids) =>
    byId(
      await prisma.payroll.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, periodStart: true },
      }),
      (row) => ({
        ref: row.periodStart.toISOString().slice(0, 7),
        href: `/hr/payroll/${row.id}`,
      }),
    ),
};

/** Where an entry's record lives when there is nothing to look up. */
const STATIC_HREF: Record<string, string> = {
  Appointment: '/appointments',
  Attendance: '/hr/attendance',
  Leave: '/hr/leave',
  VatFiling: '/finance/vat',
  TaxCode: '/finance/accounting/tax-codes',
  PaymentMode: '/finance/accounting/payment-modes',
  Organization: '/settings',
  Branch: '/settings',
  InventoryTransaction: '/inventory/movements',
};

const NOUNS: Record<string, string> = {
  Invoice: 'invoice',
  Payment: 'receipt',
  JobCard: 'job card',
  Estimate: 'quotation',
  CreditNote: 'credit note',
  Purchase: 'purchase',
  Expense: 'expense',
  JournalEntry: 'journal entry',
  SupplierPayment: 'supplier payment',
  Customer: 'customer',
  Vehicle: 'vehicle',
  Part: 'part',
  Supplier: 'supplier',
  Employee: 'employee',
  User: 'user',
  Role: 'role',
  FixedAsset: 'fixed asset',
  ChartOfAccount: 'account',
  Payroll: 'payroll',
  Appointment: 'appointment',
  Attendance: 'attendance',
  Leave: 'leave',
  VatFiling: 'VAT return',
  TaxCode: 'tax code',
  PaymentMode: 'payment mode',
  Organization: 'workshop settings',
  Branch: 'branch',
  InventoryTransaction: 'stock movement',
  BankReconciliation: 'bank reconciliation',
  Inspection: 'inspection',
  Diagnosis: 'diagnosis',
  QualityCheck: 'quality check',
  Labour: 'labour',
  PartUsage: 'part used',
  Signature: 'signature',
  Approval: 'approval',
  Document: 'document',
  Salary: 'salary',
};

/** The verb for an action, by its suffix. Anything not here is described generically. */
const VERBS: Record<string, string> = {
  created: 'Created',
  recorded: 'Recorded',
  issued: 'Issued',
  imported: 'Imported',
  updated: 'Changed',
  details_updated: 'Changed the details of',
  settings_updated: 'Changed',
  deleted: 'Deleted',
  draft_deleted: 'Deleted draft',
  archived: 'Deleted',
  restored: 'Restored',
  reversed: 'Reversed',
  voided: 'Voided',
  cancelled: 'Cancelled',
  approved: 'Approved',
  rejected: 'Rejected',
  paid: 'Recorded as paid',
  received: 'Received',
  filed: 'Filed',
  settled: 'Recorded the payment of',
  refunded: 'Refunded',
  sent: 'Sent',
  revised: 'Revised',
  duplicated: 'Duplicated',
  requested: 'Requested',
  started: 'Started',
  completed: 'Completed',
  delivered: 'Handed back',
  uploaded: 'Uploaded a photo to',
  removed: 'Removed a photo from',
  bill_attached: 'Attached a bill to',
  filled_from_scan: 'Filled from a scanned bill:',
  bill_removed: 'Removed a bill from',
  merged_in: 'Merged a duplicate into',
  merged_away: 'Merged away duplicate',
  permissions_changed: 'Changed the permissions of',
  roles_changed: 'Changed the roles of',
  password_reset: 'Reset the password of',
  password_changed: 'Changed the password of',
  activated: 'Reactivated',
  deactivated: 'Deactivated',
  technician_assigned: 'Assigned a technician to',
  status_changed: 'Changed the status of',
  ownership_transferred: 'Transferred ownership of',
  adjusted: 'Adjusted stock of',
  disposed: 'Disposed of',
  discarded: 'Discarded',
  reopened: 'Reopened',
  calculated: 'Calculated',
  recalculated: 'Recalculated',
  link_shared: 'Shared a link to',
  link_reissued: 'Reissued the link to',
  party_changed: 'Changed the customer or vehicle on',
  rescheduled: 'Rescheduled',
};

/** Whole-action sentences, where the record itself isn't the story. */
const WHOLE: Record<string, string> = {
  'books.closed': 'Closed the books',
  'books.reopened': 'Reopened the books',
  'books.year_closed': 'Closed the financial year',
  'books.year_reopened': 'Reopened the financial year',
  'books.backfilled': 'Booked existing records into the ledger',
  'accounts.standard_added': 'Added the standard chart of accounts',
  'organization.menus_changed': 'Changed which menus are shown',
  'organization.job_card_mode_changed': 'Changed the job card mode',
  'opening_balances.saved': 'Saved the opening balances',
  'opening_balances.customer_added': 'Added a customer opening balance',
  'fixed_asset.depreciation_run': 'Ran depreciation',
};

type Json = Record<string, unknown> | null;

const asObject = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function pick(sources: Json[], keys: string[]): string | null {
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number') return String(value);
    }
  }
  return null;
}

const REF_KEYS = [
  'invoiceNumber',
  'paymentNumber',
  'creditNoteNumber',
  'purchaseNumber',
  'expenseNumber',
  'entryNumber',
  'jobNumber',
  'estimateNumber',
  'supplierPaymentNumber',
  'name',
  'fullName',
  'plateNumber',
  'sku',
  'code',
];

function sentence(entry: {
  action: string;
  entityType: string;
  before: Json;
  after: Json;
  metadata: Json;
  target: Target | undefined;
}): string {
  const { action, entityType, before, after, metadata, target } = entry;
  const sources = [metadata, after, before];
  const reason = pick([metadata, after], ['reason']);
  const tail = reason ? ` — reason: ${reason}` : '';

  if (WHOLE[action]) {
    const through = pick(sources, ['closedThrough', 'throughDate', 'yearEnd', 'date']);
    return `${WHOLE[action]}${through ? ` (${through})` : ''}${tail}`;
  }

  const suffix = suffixOf(action);
  const noun = NOUNS[entityType] ?? entityType.toLowerCase();
  // For a payment, the number that means something is the receipt's own.
  const ref =
    (entityType === 'Payment' ? pick(sources, ['paymentNumber']) : null) ??
    target?.ref ??
    pick(sources, REF_KEYS);
  const rawAmount = target?.amount ?? pick(sources, ['amount', 'totalAmount', 'total']);
  const amount = rawAmount && !Number.isNaN(Number(rawAmount)) ? formatMoney(rawAmount) : null;
  const money = amount && MONEY_ACTIONS.has(suffix) ? ` ${amount}` : '';

  if (action === 'role.permissions_changed') {
    const added = Array.isArray(metadata?.added) ? metadata.added.length : null;
    const removed = Array.isArray(metadata?.removed) ? metadata.removed.length : null;
    const counts = added !== null && removed !== null ? `: ${added} added, ${removed} removed` : '';
    const why = pick([metadata], ['reason']);
    return `Changed the permissions of role ${ref ?? ''}${counts}${why ? ` — ${why}` : ''}`.replace(
      /\s+:/,
      ':',
    );
  }
  if (action === 'user.roles_changed') {
    const was = Array.isArray(before?.roles) ? before.roles.join(', ') : null;
    const now = Array.isArray(after?.roles) ? after.roles.join(', ') : null;
    return `Changed the roles of ${ref ?? 'a user'}${was !== null && now !== null ? `: ${was || 'none'} → ${now || 'none'}` : ''}`;
  }

  const verb = VERBS[suffix];
  if (verb) return `${verb} ${noun}${ref ? ` ${ref}` : ''}${money}${tail}`;
  // Anything not described above: "Job card JC-000012: technician assigned".
  const label = noun.charAt(0).toUpperCase() + noun.slice(1);
  return `${label}${ref ? ` ${ref}` : ''}: ${suffix.replace(/_/g, ' ')}${money}${tail}`;
}

/** Actions where the amount is part of the story. */
const MONEY_ACTIONS = new Set([
  'recorded',
  'issued',
  'reversed',
  'voided',
  'refunded',
  'settled',
  'paid',
  'filed',
]);

// ─── Reading ────────────────────────────────────────────────────────────────

async function describe(
  organizationId: string,
  rows: {
    id: string;
    createdAt: Date;
    action: string;
    entityType: string;
    entityId: string;
    beforeData: unknown;
    afterData: unknown;
    metadata: unknown;
    actorUser: { id: string; fullName: string } | null;
  }[],
) {
  const idsByType = new Map<string, string[]>();
  for (const row of rows) {
    if (!RESOLVERS[row.entityType]) continue;
    idsByType.set(row.entityType, [...(idsByType.get(row.entityType) ?? []), row.entityId]);
  }
  const targets = new Map<string, Map<string, Target>>();
  await Promise.all(
    [...idsByType].map(async ([type, ids]) => {
      targets.set(type, await RESOLVERS[type](organizationId, [...new Set(ids)]));
    }),
  );

  return rows.map((row) => {
    const before = asObject(row.beforeData);
    const after = asObject(row.afterData);
    const metadata = asObject(row.metadata);
    const target = targets.get(row.entityType)?.get(row.entityId);
    const jobCardId = pick([metadata, after], ['jobCardId']);
    const href =
      target?.href ??
      STATIC_HREF[row.entityType] ??
      (jobCardId && UUID.test(jobCardId) ? `/job-cards/${jobCardId}` : null);
    return {
      id: row.id,
      at: row.createdAt,
      who: row.actorUser?.fullName ?? 'System',
      whoId: row.actorUser?.id ?? null,
      action: row.action,
      module: auditModule(row.action, row.entityType),
      sentence: sentence({
        action: row.action,
        entityType: row.entityType,
        before,
        after,
        metadata,
        target,
      }),
      href,
      sensitive: isSensitive(row.action),
      before: row.beforeData ?? null,
      after: row.afterData ?? null,
      metadata: row.metadata ?? null,
    };
  });
}

const SELECT = {
  id: true,
  createdAt: true,
  action: true,
  entityType: true,
  entityId: true,
  beforeData: true,
  afterData: true,
  metadata: true,
  actorUser: { select: { id: true, fullName: true } },
} as const;

/** One page of the log, newest first, with the filters applied. */
export async function listAuditLog(user: AuthenticatedUser, filters: AuditFilters = {}) {
  requirePermission(user, 'audit.view');
  const where = buildWhere(user, filters);
  const total = await prisma.auditLog.count({ where });
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const page = Math.min(Math.max(1, Number.parseInt(filters.page ?? '1', 10) || 1), pages);
  const rows = await prisma.auditLog.findMany({
    where,
    select: SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * AUDIT_PAGE_SIZE,
    take: AUDIT_PAGE_SIZE,
  });
  return { entries: await describe(user.organizationId, rows), total, page, pages };
}

export type AuditEntry = Awaited<ReturnType<typeof listAuditLog>>['entries'][number];

/** The people and modules the filters offer. */
export async function getAuditFilterOptions(user: AuthenticatedUser) {
  requirePermission(user, 'audit.view');
  const people = await prisma.user.findMany({
    where: { organizationId: user.organizationId },
    select: { id: true, fullName: true },
    orderBy: { fullName: 'asc' },
  });
  return {
    people,
    modules: PERMISSION_MODULES.filter((module) =>
      Object.values(PREFIX_MODULE).includes(module.key),
    ).map((module) => ({ key: module.key, label: module.label })),
    types: AUDIT_TYPES,
  };
}

/** The filtered log as a spreadsheet. Needs Audit log → Export as well as View. */
export async function exportAuditLog(user: AuthenticatedUser, filters: AuditFilters = {}) {
  requirePermission(user, 'audit.view');
  requirePermission(user, 'audit.export');
  const rows = await prisma.auditLog.findMany({
    where: buildWhere(user, filters),
    select: SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: EXPORT_LIMIT,
  });
  const entries = await describe(user.organizationId, rows);
  const json = (value: unknown) => (value === null ? '' : JSON.stringify(value));
  return toCsv(entries, [
    {
      header: 'Date & time (Dubai)',
      value: (row) => toLocalDateTimeInput(row.at).replace('T', ' '),
    },
    { header: 'Who', value: (row) => row.who },
    { header: 'What happened', value: (row) => row.sentence },
    { header: 'Sensitive', value: (row) => (row.sensitive ? 'Yes' : '') },
    { header: 'Action', value: (row) => row.action },
    { header: 'Before', value: (row) => json(row.before) },
    { header: 'After', value: (row) => json(row.after) },
    { header: 'Details', value: (row) => json(row.metadata) },
  ]);
}
