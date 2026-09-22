/**
 * Integration tests for the finance dashboard: that every headline figure
 * follows the rule it claims to, in exact money, for the period it states.
 *
 *   npm run test:integration
 */
import 'dotenv/config';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/lib/prisma';
import { AuthError } from '@/lib/auth/authorize';
import { checkInVehicle } from '@/lib/workshop/check-in';
import { startInspection, saveInspection } from '@/lib/workshop/inspection';
import { saveDiagnosis } from '@/lib/workshop/diagnosis';
import {
  createEstimate,
  recordCustomerDecision,
  saveEstimateDraft,
  sendEstimate,
} from '@/lib/workshop/estimates';
import { recordLabour, startRepair } from '@/lib/workshop/repair';
import { recordQualityCheck } from '@/lib/workshop/quality-check';
import { createInvoice, recordPayment } from '@/lib/billing/invoice';
import { recordExpense, voidExpense } from '@/lib/finance/expenses';
import { getFinanceDashboard, resolvePeriod } from '@/lib/finance/dashboard';
import { localDateString, toLocalDateTimeInput } from '@/lib/format';
import { toFils } from '@/lib/money';
import { createTestOrg, RUN, type TestOrg } from './support';

let a: TestOrg;
let b: TestOrg;
let jobCardId: string;
let invoiceId: string;
const today = localDateString();
const plate = `F${RUN.slice(-4)} 77`;

/** A minute ahead: the invoice was issued seconds ago and input is minute-precision. */
const paymentTime = () => toLocalDateTimeInput(new Date(Date.now() + 60_000));

/** 3 h at 300.00 = 900.00 net, 5% VAT = 45.00, total 945.00. */
async function invoicedJob(org: TestOrg) {
  const { jobCardId: id } = await checkInVehicle(org.owner, {
    mode: 'new',
    customer: { name: 'Finance Customer', phone: '050 909 8080', email: '' },
    vehicle: { plateNumber: plate, make: 'Toyota', model: 'Prado' },
    visit: { complaint: 'Major service', mileage: '90000' },
  });
  const inspection = await startInspection(org.owner, id, org.technicianIds[0]);
  await saveInspection(
    org.owner,
    inspection.id,
    { items: [{ description: 'Service', result: 'ATTENTION_NEEDED', notes: 'Due' }] },
    { complete: true },
  );
  await saveDiagnosis(org.owner, id, {
    findings: 'Major service due',
    recommendedAction: 'Major service',
    employeeId: org.technicianIds[0],
  });
  const estimate = await createEstimate(org.owner, id);
  await saveEstimateDraft(org.owner, estimate.id, {
    validUntil: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
    items: [
      {
        itemType: 'LABOUR',
        description: 'Major service',
        quantity: '3',
        unitPrice: '300.00',
        taxRate: '5',
      },
    ],
  });
  await sendEstimate(org.owner, estimate.id);
  await recordCustomerDecision(org.owner, estimate.id, {
    decision: 'APPROVED',
    method: 'IN_PERSON',
    notes: 'Approved',
  });
  await startRepair(org.owner, id);
  const [line] = await prisma.estimateItem.findMany({ where: { estimateId: estimate.id } });
  await recordLabour(org.owner, id, {
    description: 'Major service',
    hours: '3',
    rate: '300.00',
    employeeId: org.technicianIds[0],
    estimateItemId: line.id,
  });
  await recordQualityCheck(org.owner, id, {
    result: 'PASSED',
    employeeId: org.technicianIds[0],
  });
  const invoice = await createInvoice(org.owner, id);
  return { jobCardId: id, invoiceId: invoice.id };
}

before(async () => {
  a = await createTestOrg('FinA');
  b = await createTestOrg('FinB');
  ({ jobCardId, invoiceId } = await invoicedJob(a));
});

after(async () => {
  await prisma.$disconnect();
});

describe('period', () => {
  test('presets and a custom range resolve to stated Dubai days', () => {
    assert.equal(resolvePeriod({ period: 'today' }).from, today);
    assert.equal(resolvePeriod({ period: 'today' }).to, today);

    const month = resolvePeriod({ period: 'month' });
    assert.equal(month.from, `${today.slice(0, 7)}-01`);
    assert.equal(month.to, today);

    const week = resolvePeriod({ period: 'week' });
    assert.ok(week.from <= today, 'the week starts on or before today');

    const custom = resolvePeriod({ period: 'custom', from: '2026-03-10', to: '2026-03-01' });
    assert.equal(custom.from, '2026-03-01', 'a reversed range is put the right way round');
    assert.equal(custom.to, '2026-03-10');

    // Anything unrecognised falls back to this month rather than erroring.
    assert.equal(resolvePeriod({ period: 'nonsense' }).key, 'month');
    assert.equal(resolvePeriod({ period: 'custom', from: 'oops' }).key, 'month');
  });

  test('the window ends at the following midnight, so the last day is included', () => {
    const p = resolvePeriod({ period: 'custom', from: '2026-03-01', to: '2026-03-01' });
    assert.equal(p.end.getTime() - p.start.getTime(), 86_400_000);
  });
});

describe('finance dashboard', () => {
  test('revenue is the invoices issued in the period, at their own amounts', async () => {
    const data = await getFinanceDashboard(a.owner, { period: 'today' });
    assert.equal(data.revenue?.net, '900.00');
    assert.equal(data.revenue?.vat, '45.00');
    assert.equal(data.revenue?.gross, '945.00');
    assert.equal(data.revenue?.count, 1);
    assert.equal(data.period.from, today);
  });

  test('a period with no activity reports zero, not a wrong number', async () => {
    const data = await getFinanceDashboard(a.owner, {
      period: 'custom',
      from: '2020-01-01',
      to: '2020-01-31',
    });
    assert.equal(data.revenue?.net, '0.00');
    assert.equal(data.revenue?.count, 0);
    assert.equal(data.revenue?.collected, '0.00');
    assert.equal(data.expenses?.net, '0.00');
    assert.equal(data.vat.output, '0.00');
  });

  test('collected counts payments received in the period', async () => {
    let data = await getFinanceDashboard(a.owner, { period: 'today' });
    assert.equal(data.revenue?.collected, '0.00', 'nothing paid yet');

    await recordPayment(a.owner, jobCardId, {
      amount: '445.00',
      method: 'CASH',
      receivedAt: paymentTime(),
    });
    data = await getFinanceDashboard(a.owner, { period: 'today' });
    assert.equal(data.revenue?.collected, '445.00');
    // Invoiced is unchanged: collecting is not invoicing.
    assert.equal(data.revenue?.net, '900.00');

    const old = await getFinanceDashboard(a.owner, {
      period: 'custom',
      from: '2020-01-01',
      to: '2020-01-31',
    });
    assert.equal(old.revenue?.collected, '0.00', 'a payment counts only in its own period');
  });

  test('customer outstanding matches the invoice balance exactly', async () => {
    const data = await getFinanceDashboard(a.owner, { period: 'today' });
    assert.equal(data.receivables?.balance, '500.00', '945.00 less 445.00 paid');
    assert.equal(data.receivables?.count, 1);
    assert.equal(data.receivables?.parties, 1);
    assert.ok(data.receivables?.recent.some((row) => row.id === invoiceId));
  });

  test('expenses are exact, and a voided expense stops counting', async () => {
    const expense = await recordExpense(a.owner, {
      description: 'Workshop rent',
      amount: '2000.00',
      taxRate: '5',
      expenseDate: today,
      paymentMethod: 'BANK_TRANSFER',
    });
    let data = await getFinanceDashboard(a.owner, { period: 'today' });
    assert.equal(data.expenses?.net, '2000.00');
    assert.equal(data.expenses?.vat, '100.00');
    assert.equal(data.expenses?.gross, '2100.00');
    assert.equal(data.expenses?.count, 1);

    // Revenue less expenses, both excluding VAT.
    assert.equal(data.position?.net, '-1100.00', '900.00 revenue less 2000.00 expenses');

    await voidExpense(a.owner, expense.id, { reason: 'Entered twice' });
    data = await getFinanceDashboard(a.owner, { period: 'today' });
    assert.equal(data.expenses?.net, '0.00', 'a voided expense is not spending');
    assert.equal(data.expenses?.count, 0);
    assert.equal(data.position?.net, '900.00');
  });

  test('top expense categories are ranked by amount', async () => {
    const [rent, misc] = await Promise.all([
      prisma.chartOfAccount.create({
        data: {
          organizationId: a.organizationId,
          accountCode: `6100-${RUN}`,
          accountName: 'Rent',
          accountType: 'EXPENSE',
        },
      }),
      prisma.chartOfAccount.create({
        data: {
          organizationId: a.organizationId,
          accountCode: `6200-${RUN}`,
          accountName: 'Utilities',
          accountType: 'EXPENSE',
        },
      }),
    ]);
    await recordExpense(a.owner, {
      description: 'Rent',
      amount: '3000.00',
      taxRate: '',
      expenseDate: today,
      categoryId: rent.id,
    });
    await recordExpense(a.owner, {
      description: 'Electricity',
      amount: '500.00',
      taxRate: '',
      expenseDate: today,
      categoryId: misc.id,
    });
    const data = await getFinanceDashboard(a.owner, { period: 'today' });
    assert.equal(data.expenses?.topCategories[0].name, 'Rent');
    assert.equal(data.expenses?.topCategories[0].net, '3000.00');
    assert.equal(data.expenses?.topCategories[1].name, 'Utilities');
    assert.equal(data.expenses?.net, '3500.00');
  });

  test('VAT follows the organization, and a non-registered workshop reports zero', async () => {
    let data = await getFinanceDashboard(a.owner, { period: 'today' });
    assert.equal(data.vat.isRegistered, true);
    assert.equal(data.vat.rate, '5.00');
    assert.equal(data.vat.output, '45.00', 'VAT on the invoices issued');
    assert.equal(data.vat.input, '0.00', 'both remaining expenses carry no VAT');
    assert.equal(data.vat.net, '45.00');

    await prisma.organization.update({
      where: { id: a.organizationId },
      data: { isVatRegistered: false },
    });
    data = await getFinanceDashboard(a.owner, { period: 'today' });
    assert.equal(data.vat.isRegistered, false);
    assert.equal(data.vat.output, '0.00', 'nothing is charged');
    assert.equal(data.vat.input, '0.00');
    assert.equal(data.vat.net, '0.00');
    assert.equal(data.revenue?.net, '900.00', 'revenue itself is unaffected');

    await prisma.organization.update({
      where: { id: a.organizationId },
      data: { isVatRegistered: true },
    });
  });

  test('supplier payables come from purchases, not from stock', async () => {
    const data = await getFinanceDashboard(a.owner, { period: 'today' });
    assert.equal(data.payables?.balance, '0.00');
    assert.equal(data.payables?.count, 0);
  });

  test('another organization sees none of this', async () => {
    const theirs = await getFinanceDashboard(b.owner, { period: 'today' });
    assert.equal(theirs.revenue?.net, '0.00');
    assert.equal(theirs.receivables?.balance, '0.00');
    assert.equal(theirs.expenses?.net, '0.00');
    assert.equal(
      theirs.recent.invoices.some((invoice) => invoice.id === invoiceId),
      false,
    );
  });

  test('a user with no finance permission is refused outright', async () => {
    await assert.rejects(
      getFinanceDashboard({ ...a.owner, orgWidePermissions: new Set() }, { period: 'today' }),
      (error: unknown) => error instanceof AuthError,
    );
  });

  test('each section is hidden unless its own permission is held', async () => {
    const salesOnly = await getFinanceDashboard(
      { ...a.owner, orgWidePermissions: new Set(['invoice.view']) },
      { period: 'today' },
    );
    assert.ok(salesOnly.revenue, 'sales figures are shown');
    assert.equal(salesOnly.expenses, null, 'expenses are withheld');
    assert.equal(salesOnly.payables, null, 'payables are withheld');
    assert.equal(salesOnly.position, null, 'no margin without both sides');
    assert.equal(salesOnly.recent.expenses.length, 0);

    const expensesOnly = await getFinanceDashboard(
      { ...a.owner, orgWidePermissions: new Set(['accounting.view']) },
      { period: 'today' },
    );
    assert.equal(expensesOnly.revenue, null, 'sales are withheld');
    assert.equal(expensesOnly.receivables, null);
    assert.ok(expensesOnly.expenses, 'expenses are shown');
    assert.equal(expensesOnly.recent.invoices.length, 0);
    assert.equal(expensesOnly.recent.payments.length, 0);
  });

  test('a branch-scoped user sees only their branch', async () => {
    const other = await prisma.branch.create({
      data: { organizationId: a.organizationId, code: `X${RUN.slice(-3)}`, name: 'Other branch' },
    });
    const elsewhere = await getFinanceDashboard(
      { ...a.owner, primaryBranchId: other.id },
      { period: 'today' },
    );
    assert.equal(elsewhere.revenue?.net, '0.00', 'another branch’s invoices are not theirs');
    assert.equal(elsewhere.expenses?.net, '0.00');
    assert.equal(elsewhere.receivables?.balance, '0.00');
  });

  test('every money figure is a two-decimal string, never a float', async () => {
    const data = await getFinanceDashboard(a.owner, { period: 'month' });
    const amounts = [
      data.revenue?.net,
      data.revenue?.vat,
      data.revenue?.gross,
      data.revenue?.collected,
      data.expenses?.net,
      data.expenses?.vat,
      data.expenses?.gross,
      data.vat.output,
      data.vat.input,
      data.vat.net,
      data.receivables?.balance,
      data.receivables?.overdue,
      data.payables?.balance,
      data.position?.net,
    ].filter(Boolean) as string[];
    for (const amount of amounts) {
      assert.match(amount, /^-?\d+\.\d{2}$/, `${amount} is exact money`);
      assert.equal(typeof toFils(amount.replace('-', '')), 'number');
    }
  });
});
