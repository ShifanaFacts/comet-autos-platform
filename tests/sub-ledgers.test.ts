/**
 * Customer and supplier sub-ledgers in manual journal entries: a line on an
 * account kept per party names the customer or supplier, counts in their
 * balance, statement and the owing lists, and comes off again when the
 * entry is reversed. Runs against the hosted database (test organization).
 */
import 'dotenv/config';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AccountRole } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { ensureChart } from '@/lib/accounting/chart';
import { createManualEntry, reverseManualEntry } from '@/lib/accounting/entries';
import { createAccount, updateAccount } from '@/lib/finance/accounting';
import { getCustomerStatement, getSupplierStatement } from '@/lib/finance/statements';
import { getCustomerOutstanding, getSupplierOutstanding } from '@/lib/finance/outstanding';
import { listSuppliers } from '@/lib/inventory/suppliers';
import { customerJournalTotals } from '@/lib/accounting/sub-ledger';
import { localDateString } from '@/lib/format';
import { createTestOrg, expectDomainError, RUN, type TestOrg } from './support';

let a: TestOrg;
let roles: Record<AccountRole, string>;
let customerId: string;
let supplierId: string;

before(async () => {
  a = await createTestOrg('Sub-ledgers');
  roles = await prisma.$transaction((tx) => ensureChart(tx, a.organizationId));
  customerId = (
    await prisma.customer.create({
      data: {
        organizationId: a.organizationId,
        name: `Ledger Customer ${RUN}`,
        phone: '050 700 1001',
      },
    })
  ).id;
  supplierId = (
    await prisma.supplier.create({
      data: { organizationId: a.organizationId, name: `Ledger Supplier ${RUN}` },
    })
  ).id;
});

after(async () => {
  await prisma.$disconnect();
});

const today = () => localDateString();

describe('a manual line on a party account', () => {
  test('trade receivables must name the customer; other accounts can’t name anyone', async () => {
    await expectDomainError(
      createManualEntry(a.owner, {
        date: today(),
        description: 'Opening balance owed by a customer',
        lines: [
          { accountId: roles.ACCOUNTS_RECEIVABLE, debit: '300' },
          { accountId: roles.OPENING_BALANCE, credit: '300' },
        ],
      }),
      /kept per customer — choose the customer/,
    );
    await expectDomainError(
      createManualEntry(a.owner, {
        date: today(),
        description: 'Bank line naming a customer',
        lines: [
          { accountId: roles.ACCOUNTS_RECEIVABLE, debit: '300', partyId: customerId },
          { accountId: roles.OPENING_BALANCE, credit: '300', partyId: customerId },
        ],
      }),
      /isn't kept per customer or supplier/,
    );
    // A supplier on a customer account is not a customer.
    await expectDomainError(
      createManualEntry(a.owner, {
        date: today(),
        description: 'Wrong party',
        lines: [
          { accountId: roles.ACCOUNTS_RECEIVABLE, debit: '300', partyId: supplierId },
          { accountId: roles.OPENING_BALANCE, credit: '300' },
        ],
      }),
      /choose the customer/,
    );
  });

  test('a customer’s amount counts in their balance, statement and the owing list — and a reversal takes it off', async () => {
    const entry = await createManualEntry(a.owner, {
      date: today(),
      description: 'Opening balance owed by a customer',
      lines: [
        { accountId: roles.ACCOUNTS_RECEIVABLE, debit: '300', partyId: customerId },
        { accountId: roles.OPENING_BALANCE, credit: '300' },
      ],
    });
    const line = await prisma.journalEntryLine.findFirstOrThrow({
      where: { journalEntryId: entry.id, chartOfAccountId: roles.ACCOUNTS_RECEIVABLE },
    });
    assert.equal(line.customerId, customerId);

    const statement = await getCustomerStatement(a.owner, customerId);
    assert.equal(statement.closing, '300.00');
    assert.ok(
      statement.lines.some((row) => row.kind === 'Journal entry' && row.debit === '300.00'),
    );

    const owing = await getCustomerOutstanding(a.owner);
    const row = owing.rows.find((r) => r.kind === 'journal' && r.party.id === customerId);
    assert.ok(row, 'the customer’s journal amount is on the owing list');
    assert.equal(row.balance, '300.00');

    const reversal = await reverseManualEntry(a.owner, entry.id, {
      date: today(),
      reason: 'Entered on the wrong customer',
    });
    const reversed = await prisma.journalEntryLine.findFirstOrThrow({
      where: { journalEntryId: reversal.id, chartOfAccountId: roles.ACCOUNTS_RECEIVABLE },
    });
    assert.equal(reversed.customerId, customerId, 'the reversal names the same customer');
    const totals = await customerJournalTotals(prisma, a.organizationId, [customerId]);
    assert.equal(totals.get(customerId), 0);
    assert.equal((await getCustomerStatement(a.owner, customerId)).closing, '0.00');
    assert.ok(
      !(await getCustomerOutstanding(a.owner)).rows.some(
        (r) => r.kind === 'journal' && r.party.id === customerId,
      ),
      'netted to nothing: off the list',
    );
  });

  test('a supplier’s amount counts in what is owed to them', async () => {
    await createManualEntry(a.owner, {
      date: today(),
      description: 'Opening balance owed to a supplier',
      lines: [
        { accountId: roles.OPENING_BALANCE, debit: '120' },
        { accountId: roles.ACCOUNTS_PAYABLE, credit: '120', partyId: supplierId },
      ],
    });
    const owing = await getSupplierOutstanding(a.owner);
    const row = owing.rows.find((r) => r.kind === 'journal' && r.party.id === supplierId);
    assert.equal(row?.balance, '120.00');
    const listed = (await listSuppliers(a.owner, `Ledger Supplier ${RUN}`)).find(
      (s) => s.id === supplierId,
    );
    assert.equal(listed?.balance.outstanding, '120.00');
    const statement = await getSupplierStatement(a.owner, supplierId);
    assert.ok(statement.lines.some((line) => line.kind === 'Journal entry'));
  });
});

describe('the account setting', () => {
  test('only an asset or liability can be kept per party; trade receivables is fixed; a used account keeps its setting', async () => {
    await expectDomainError(
      createAccount(a.owner, {
        accountCode: `X${RUN.slice(-4)}`,
        accountName: 'Customer expenses',
        accountType: 'EXPENSE',
        subLedger: 'CUSTOMER',
      }),
      /Only an asset or a liability/,
    );
    const other = await createAccount(a.owner, {
      accountCode: `OR${RUN.slice(-4)}`,
      accountName: 'Other receivables',
      accountType: 'ASSET',
      subLedger: 'CUSTOMER',
    });
    await expectDomainError(
      createManualEntry(a.owner, {
        date: today(),
        description: 'Loan to a customer',
        lines: [
          { accountId: other.id, debit: '50' },
          { accountId: roles.BANK, credit: '50' },
        ],
      }),
      /choose the customer/,
    );
    await createManualEntry(a.owner, {
      date: today(),
      description: 'Loan to a customer',
      lines: [
        { accountId: other.id, debit: '50', partyId: customerId },
        { accountId: roles.BANK, credit: '50' },
      ],
    });
    await expectDomainError(
      updateAccount(a.owner, other.id, {
        accountCode: other.accountCode,
        accountName: other.accountName,
        subLedger: '',
      }),
      /can no longer change/,
    );
    await expectDomainError(
      updateAccount(a.owner, roles.ACCOUNTS_RECEIVABLE, {
        accountCode: '1100',
        accountName: 'Trade receivables',
        subLedger: '',
      }),
      /always kept per customer/,
    );
  });
});
