/**
 * Integration tests for where the books start and where a year ends:
 *
 *  - opening balances: the general accounts are booked as one entry, the
 *    difference to opening balance equity; accounts a register already
 *    carries are refused; saving the same figures changes nothing, new
 *    figures replace the entry by reversal;
 *  - a customer's opening balance is owed like an invoice — it takes a
 *    receipt, shows on the statement, and can't be removed once paid;
 *  - year-end closing zeroes income and expenses into retained earnings, is
 *    left out of the profit and loss, can be reopened, and can be booked
 *    into a period already closed;
 *  - the cash-flow statement explains the change in cash, opening balances
 *    counted as cash at the start, never as a flow.
 *
 * Every record is made in a throwaway test organization. Needs the
 * 20260929180000_opening_balances_year_end migration applied.
 *
 *   npm run test:integration
 */
import 'dotenv/config';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AccountRole } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { ensureChart } from '@/lib/accounting/chart';
import { createManualEntry } from '@/lib/accounting/entries';
import {
  addCustomerOpeningBalance,
  getOpeningBalances,
  removeCustomerOpeningBalance,
  saveOpeningBalances,
} from '@/lib/accounting/opening-balances';
import { closeFinancialYear, getYearEnd, reopenFinancialYear } from '@/lib/accounting/year-end';
import { getCashFlowStatement } from '@/lib/accounting/cash-flow';
import { getBalanceSheet, getLedgerProfitAndLoss, getTrialBalance } from '@/lib/accounting/reports';
import { recordInvoicePayment } from '@/lib/billing/invoice';
import { getCustomerStatement } from '@/lib/finance/statements';
import { toLocalDateTimeInput } from '@/lib/format';
import { createTestOrg, expectDomainError, RUN, type TestOrg } from './support';

let a: TestOrg;
let roles: Record<AccountRole, string>;

const OPENING = '2025-12-31';
const YEAR_END = '2026-06-30';

before(async () => {
  a = await createTestOrg('OpenClose');
  roles = await prisma.$transaction((tx) => ensureChart(tx, a.organizationId));
});

after(async () => {
  await prisma.$disconnect();
});

async function customer(suffix: string) {
  return prisma.customer.create({
    data: {
      organizationId: a.organizationId,
      name: `Opening Customer ${suffix} ${RUN}`,
      phone: `050 ${suffix.padStart(3, '0')} 6644`,
    },
  });
}

/** The balance an account shows on the balance sheet, by role. */
function balanceOf(
  sheet: Awaited<ReturnType<typeof getBalanceSheet>>,
  accountId: string,
): string | undefined {
  return [...sheet.assets.rows, ...sheet.liabilities.rows, ...sheet.equity.rows].find(
    (row) => row.id === accountId,
  )?.amount;
}

describe('opening balances — general accounts', () => {
  test('booked as one entry, the difference to opening balance equity', async () => {
    const result = await saveOpeningBalances(a.owner, {
      date: OPENING,
      lines: [
        { accountId: roles.CASH, debit: '5000.00' },
        { accountId: roles.BANK, debit: '20000' },
        { accountId: roles.SALARIES_PAYABLE, credit: '3000.00' },
      ],
    });
    assert.equal(result.changed, true);
    assert.ok(result.entryNumber?.startsWith('JV-'));

    const sheet = await getBalanceSheet(a.owner, { asOf: OPENING });
    assert.equal(balanceOf(sheet, roles.CASH), '5000.00');
    assert.equal(balanceOf(sheet, roles.BANK), '20000.00');
    assert.equal(balanceOf(sheet, roles.OPENING_BALANCE), '22000.00');
    assert.equal(sheet.balanced, true);

    const screen = await getOpeningBalances(a.owner);
    assert.equal(screen.date, OPENING);
    assert.equal(screen.rows.find((row) => row.id === roles.BANK)?.debit, '20000.00');
    assert.equal(
      screen.rows.find((row) => row.id === roles.ACCOUNTS_RECEIVABLE)?.managed !== null,
      true,
      'receivables come from the customers, not typed',
    );
  });

  test('the same figures change nothing; new figures replace the entry', async () => {
    const same = await saveOpeningBalances(a.owner, {
      date: OPENING,
      lines: [
        { accountId: roles.CASH, debit: '5000' },
        { accountId: roles.BANK, debit: '20000.00' },
        { accountId: roles.SALARIES_PAYABLE, credit: '3000' },
      ],
    });
    assert.equal(same.changed, false);

    await saveOpeningBalances(a.owner, {
      date: OPENING,
      lines: [
        { accountId: roles.CASH, debit: '5000' },
        { accountId: roles.BANK, debit: '25000' },
        { accountId: roles.SALARIES_PAYABLE, credit: '3000' },
      ],
    });
    const standing = await prisma.journalEntry.count({
      where: {
        organizationId: a.organizationId,
        sourceType: 'OPENING_BALANCE',
        reversalOfJournalEntryId: null,
        reversals: { none: {} },
      },
    });
    assert.equal(standing, 1, 'one opening entry stands; the old one is reversed');
    const sheet = await getBalanceSheet(a.owner, { asOf: OPENING });
    assert.equal(balanceOf(sheet, roles.BANK), '25000.00');
    assert.equal(balanceOf(sheet, roles.OPENING_BALANCE), '27000.00');
  });

  test('accounts a register carries, and income or expense, are refused', async () => {
    await expectDomainError(
      saveOpeningBalances(a.owner, {
        date: OPENING,
        lines: [{ accountId: roles.ACCOUNTS_RECEIVABLE, debit: '100' }],
      }),
      /customer opening balances/i,
    );
    await expectDomainError(
      saveOpeningBalances(a.owner, {
        date: OPENING,
        lines: [{ accountId: roles.SALES_OTHER, credit: '100' }],
      }),
      /income or expense account/,
    );
  });
});

describe('opening balances — customers', () => {
  let invoiceId: string;

  test('owed like an invoice: receivable, statement, receipt', async () => {
    const owner = await customer('1');
    const invoice = await addCustomerOpeningBalance(a.owner, {
      customerId: owner.id,
      amount: '1500.00',
      reference: 'Old invoices 101–104',
    });
    invoiceId = invoice.id;
    assert.equal(invoice.invoiceType, 'OPENING_BALANCE');
    assert.ok(invoice.invoiceNumber.startsWith('OB-'));
    assert.equal(invoice.taxAmount.toString(), '0');

    const sheet = await getBalanceSheet(a.owner, { asOf: OPENING });
    assert.equal(balanceOf(sheet, roles.ACCOUNTS_RECEIVABLE), '1500.00');
    assert.equal(balanceOf(sheet, roles.OPENING_BALANCE), '28500.00');

    await expectDomainError(
      addCustomerOpeningBalance(a.owner, { customerId: owner.id, amount: '10' }),
      /already has opening balance/,
    );

    await recordInvoicePayment(a.owner, invoiceId, {
      amount: '500.00',
      method: 'CASH',
      receivedAt: toLocalDateTimeInput(new Date()),
    });
    const statement = await getCustomerStatement(a.owner, owner.id, {});
    assert.equal(statement.closing, '1000.00');
  });

  test('once a receipt is taken it stays; one never paid can be removed', async () => {
    await expectDomainError(
      removeCustomerOpeningBalance(a.owner, invoiceId, { reason: 'Wrong amount' }),
      /payment/i,
    );
    const other = await customer('2');
    const invoice = await addCustomerOpeningBalance(a.owner, {
      customerId: other.id,
      amount: '250',
    });
    await removeCustomerOpeningBalance(a.owner, invoice.id, { reason: 'Entered by mistake' });
    const voided = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    assert.equal(voided.status, 'VOID');
  });

  test('the opening date can’t move while a customer balance holds it', async () => {
    await expectDomainError(
      saveOpeningBalances(a.owner, { date: '2025-11-30', lines: [] }),
      /Remove them before changing the opening date/,
    );
  });
});

describe('year-end closing', () => {
  let closingId: string;

  test('income and expenses close into retained earnings', async () => {
    await createManualEntry(a.owner, {
      date: '2026-02-15',
      description: 'Sublet work invoiced outside the system',
      lines: [
        { accountId: roles.BANK, debit: '1000' },
        { accountId: roles.SALES_OTHER, credit: '1000' },
      ],
    });
    await createManualEntry(a.owner, {
      date: '2026-03-10',
      description: 'Sundry expense',
      lines: [
        { accountId: roles.OTHER_EXPENSES, debit: '400' },
        { accountId: roles.BANK, credit: '400' },
      ],
    });

    const preview = await getYearEnd(a.owner, { yearEnd: YEAR_END });
    assert.equal(preview.preview.profit, '600.00');
    assert.equal(preview.alreadyClosed, false);

    const closed = await closeFinancialYear(a.owner, { yearEnd: YEAR_END, lockBooks: 'on' });
    assert.equal(closed.profit, '600.00');

    const trial = await getTrialBalance(a.owner, { asOf: YEAR_END });
    const net = (id: string) => {
      const row = trial.rows.find((r) => r.id === id);
      return row ? `${row.debit}/${row.credit}` : '0.00/0.00';
    };
    assert.equal(net(roles.SALES_OTHER), '0.00/0.00', 'income is back to zero');
    assert.equal(net(roles.OTHER_EXPENSES), '0.00/0.00', 'expenses too');
    assert.equal(trial.balanced, true);

    const sheet = await getBalanceSheet(a.owner, { asOf: YEAR_END });
    assert.equal(balanceOf(sheet, roles.RETAINED_EARNINGS), '600.00');
    assert.equal(sheet.equity.earnings, '0.00', 'no unclosed profit left for the year');
    assert.equal(sheet.balanced, true);

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: a.organizationId },
    });
    assert.equal(organization.booksClosedThrough?.toISOString().slice(0, 10), YEAR_END);

    const years = await getYearEnd(a.owner, { yearEnd: YEAR_END });
    assert.equal(years.alreadyClosed, true);
    closingId = years.closings[0].id;
    assert.equal(years.closings[0].profit, '600.00');
  });

  test('the closed year still reports what it earned', async () => {
    const pl = await getLedgerProfitAndLoss(a.owner, {
      period: 'custom',
      from: '2026-01-01',
      to: YEAR_END,
    });
    assert.equal(pl.netProfit, '600.00');
  });

  test('closed once only; reopened by reversal, inside the closed period', async () => {
    await expectDomainError(
      closeFinancialYear(a.owner, { yearEnd: YEAR_END }),
      /already closed for the year ending/,
    );
    await reopenFinancialYear(a.owner, closingId, { reason: 'Audit adjustment' });
    const sheet = await getBalanceSheet(a.owner, { asOf: YEAR_END });
    assert.equal(balanceOf(sheet, roles.RETAINED_EARNINGS) ?? '0.00', '0.00');
    assert.equal(sheet.equity.earnings, '600.00');
    // Closed again even though the books are locked through that date.
    await closeFinancialYear(a.owner, { yearEnd: YEAR_END });
    const again = await getBalanceSheet(a.owner, { asOf: YEAR_END });
    assert.equal(balanceOf(again, roles.RETAINED_EARNINGS), '600.00');
  });

  test('a year that has not ended can’t be closed', async () => {
    await expectDomainError(
      closeFinancialYear(a.owner, { yearEnd: '2999-12-31' }),
      /once it has ended/,
    );
  });
});

describe('cash-flow statement', () => {
  test('explains the change in cash; opening balances are cash at the start', async () => {
    const half = await getCashFlowStatement(a.owner, {
      period: 'custom',
      from: '2026-01-01',
      to: YEAR_END,
    });
    assert.equal(half.opening, '30000.00');
    assert.equal(half.operating.profit, '600.00');
    assert.equal(half.netChange, '600.00');
    assert.equal(half.closing, '30600.00');
    assert.equal(half.reconciles, true);

    const withOpening = await getCashFlowStatement(a.owner, {
      period: 'custom',
      from: '2025-12-01',
      to: YEAR_END,
    });
    assert.equal(withOpening.broughtIn, '30000.00', 'the opening cash is not an inflow');
    assert.equal(withOpening.netChange, '600.00');
    assert.equal(withOpening.reconciles, true);
  });
});
