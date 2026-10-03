/**
 * Integration tests for Money (lib/finance/money.ts):
 *
 *  - moving money between the workshop's own accounts books Dr the account
 *    it went to, Cr the one it came from — nothing earned or spent — and
 *    both balances on the Money screen follow;
 *  - a void keeps the transfer on record and reverses its entry;
 *  - a transfer needs two different money accounts, an amount above zero
 *    and a date not in the future;
 *  - "money now" counts cash, petty cash and bank, and never a debt on a
 *    company card;
 *  - an account's activity runs its balance movement by movement;
 *  - someone who may only look cannot move money.
 *
 * Every record is made in a throwaway test organization.
 *
 *   npm run test:integration
 */
import 'dotenv/config';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AccountRole } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { AuthError } from '@/lib/auth/authorize';
import { ensureChart } from '@/lib/accounting/chart';
import { countUnbooked } from '@/lib/accounting/entries';
import { getBalanceSheet } from '@/lib/accounting/reports';
import {
  getMoneyAccountActivity,
  getMoneyOverview,
  recordMoneyTransfer,
  voidMoneyTransfer,
} from '@/lib/finance/money';
import { recordExpense } from '@/lib/finance/expenses';
import {
  addPartner,
  listOwnerMoney,
  recordOwnerMoney,
  voidOwnerMoney,
} from '@/lib/finance/owner-money';
import { toFils } from '@/lib/money';
import { localDateString } from '@/lib/format';
import { createTestOrg, expectDomainError, RUN, type TestOrg } from './support';

let a: TestOrg;
let roles: Record<AccountRole, string>;
let pettyId: string;

before(async () => {
  a = await createTestOrg('Money');
  roles = await prisma.$transaction((tx) => ensureChart(tx, a.organizationId));
  pettyId = (
    await prisma.chartOfAccount.findFirstOrThrow({
      where: { organizationId: a.organizationId, accountCode: '1005' },
    })
  ).id;
});

after(async () => {
  await prisma.$disconnect();
});

const today = () => localDateString();

/** Net debit per account, in fils, over the entries booking a record. */
async function bookedFor(sourceId: string) {
  const lines = await prisma.journalEntryLine.findMany({
    where: { organizationId: a.organizationId, journalEntry: { sourceId } },
    select: { chartOfAccountId: true, debitAmount: true, creditAmount: true },
  });
  const net = new Map<string, number>();
  for (const line of lines) {
    const value = toFils(line.debitAmount.toString()) - toFils(line.creditAmount.toString());
    net.set(line.chartOfAccountId, (net.get(line.chartOfAccountId) ?? 0) + value);
  }
  return net;
}

const balanceOf = async (accountId: string) =>
  (await getMoneyOverview(a.owner)).groups
    .flatMap((group) => group.accounts)
    .find((account) => account.id === accountId)?.balance;

describe('moving money', () => {
  let transferId: string;

  test('cash on hand into petty cash: a move, not income or expense', async () => {
    const transfer = await recordMoneyTransfer(a.owner, {
      fromAccountId: roles.CASH,
      toAccountId: pettyId,
      amount: '500',
      transferredOn: today(),
      reference: `TOPUP-${RUN}`,
    });
    transferId = transfer.id;
    assert.match(transfer.transferNumber, /^TRF-/);
    const booked = await bookedFor(transfer.id);
    assert.equal(booked.get(pettyId), toFils('500.00'), 'into petty cash');
    assert.equal(booked.get(roles.CASH), -toFils('500.00'), 'out of cash on hand');
    assert.equal(booked.size, 2, 'no other account is touched');
    assert.equal(await balanceOf(pettyId), '500.00');
    assert.equal(await balanceOf(roles.CASH), '-500.00');
  });

  test('a petty-cash expense comes out of the box', async () => {
    await recordExpense(a.owner, {
      description: `Stationery ${RUN}`,
      amount: '40',
      expenseDate: today(),
      paymentMethod: 'CASH',
      paidFromAccountId: pettyId,
    });
    const activity = await getMoneyAccountActivity(a.owner, pettyId);
    assert.equal(activity.account.balance, '460.00');
    // Newest first: the expense, then the top-up, each with the balance after it.
    assert.deepEqual(
      activity.rows.map((row) => [row.moneyIn, row.moneyOut, row.balance]),
      [
        ['', '40.00', '460.00'],
        ['500.00', '', '500.00'],
      ],
    );
  });

  test('voided: kept on record, its entry reversed, both balances back', async () => {
    await voidMoneyTransfer(a.owner, transferId, { reason: 'Entered twice' });
    const transfer = await prisma.moneyTransfer.findUniqueOrThrow({ where: { id: transferId } });
    assert.equal(transfer.status, 'VOID');
    const net = await bookedFor(transferId);
    assert.ok(
      [...net.values()].every((value) => value === 0),
      'nothing stands',
    );
    assert.equal(await balanceOf(pettyId), '-40.00');
    await expectDomainError(
      voidMoneyTransfer(a.owner, transferId, { reason: 'Again' }),
      /already void/,
    );
  });

  test('two different money accounts, an amount, a date not in the future', async () => {
    await expectDomainError(
      recordMoneyTransfer(a.owner, {
        fromAccountId: roles.CASH,
        toAccountId: roles.CASH,
        amount: '10',
        transferredOn: today(),
      }),
      /two different accounts/,
    );
    await expectDomainError(
      recordMoneyTransfer(a.owner, {
        fromAccountId: roles.CASH,
        toAccountId: roles.SALES_LABOUR,
        amount: '10',
        transferredOn: today(),
      }),
      /cash, bank or card account/,
    );
    await expectDomainError(
      recordMoneyTransfer(a.owner, {
        fromAccountId: roles.CASH,
        toAccountId: roles.BANK,
        amount: '0',
        transferredOn: today(),
      }),
      /above zero/,
    );
    await expectDomainError(
      recordMoneyTransfer(a.owner, {
        fromAccountId: roles.CASH,
        toAccountId: roles.BANK,
        amount: '10',
        transferredOn: '2999-01-01',
      }),
      /future/,
    );
  });

  test('someone who may only look cannot move money', async () => {
    await assert.rejects(
      recordMoneyTransfer(a.viewer, {
        fromAccountId: roles.CASH,
        toAccountId: roles.BANK,
        amount: '10',
        transferredOn: today(),
      }),
      AuthError,
    );
    await assert.rejects(getMoneyOverview(a.viewer), AuthError);
  });
});

describe('money now', () => {
  test('cash, petty cash and bank count; a company card debt does not', async () => {
    const card = await prisma.chartOfAccount.create({
      data: {
        organizationId: a.organizationId,
        accountCode: '2045',
        accountName: `Test company credit card ${RUN}`,
        accountType: 'LIABILITY',
        isPaymentAccount: true,
      },
    });
    // Take the bank to 300 and run the card up to 120.
    await recordMoneyTransfer(a.owner, {
      fromAccountId: card.id,
      toAccountId: roles.BANK,
      amount: '120',
      transferredOn: today(),
    });
    await recordMoneyTransfer(a.owner, {
      fromAccountId: roles.CASH,
      toAccountId: roles.BANK,
      amount: '180',
      transferredOn: today(),
    });
    const overview = await getMoneyOverview(a.owner);
    const of = (kind: string) => overview.groups.find((group) => group.kind === kind)?.total;
    assert.equal(of('company-card'), '120.00', 'owed on the card, shown as owed');
    assert.equal(overview.owedOnCards, '120.00');
    assert.equal(of('cash'), '-180.00');
    assert.equal(of('bank'), '300.00');
    assert.equal(of('petty'), '-40.00');
    // −180 + 300 − 40: the card's 120 owed is not money and is not taken off.
    assert.equal(overview.moneyNow, '80.00');
  });

  test('everything balances and nothing is left unbooked', async () => {
    assert.equal((await getBalanceSheet(a.owner)).balanced, true);
    assert.equal(await countUnbooked(a.owner), 0);
  });
});

describe('owner’s money', () => {
  const cashFils = async () =>
    toFils((await balanceOf(roles.CASH))!.replace('-', '')) *
    ((await balanceOf(roles.CASH))!.startsWith('-') ? -1 : 1);

  test('Owner’s capital and drawings are system accounts on 3000 and 3100', async () => {
    const accounts = await prisma.chartOfAccount.findMany({
      where: { id: { in: [roles.OWNER_CAPITAL, roles.OWNER_DRAWINGS] } },
      select: { id: true, accountCode: true },
    });
    const code = new Map(accounts.map((row) => [row.id, row.accountCode]));
    assert.equal(code.get(roles.OWNER_CAPITAL), '3000');
    assert.equal(code.get(roles.OWNER_DRAWINGS), '3100');
  });

  test('money put in: Dr cash, Cr Owner’s capital — the cash goes up, nothing earned', async () => {
    const before = await cashFils();
    const row = await recordOwnerMoney(a.owner, {
      kind: 'CAPITAL_IN',
      accountId: roles.CASH,
      amount: '6000',
      movedOn: today(),
      notes: 'For parts and running costs',
    });
    assert.match(row.entryNumber, /^OWN-/);
    const booked = await bookedFor(row.id);
    assert.equal(booked.get(roles.CASH), toFils('6000.00'));
    assert.equal(booked.get(roles.OWNER_CAPITAL), -toFils('6000.00'));
    assert.equal(booked.size, 2);
    assert.equal((await cashFils()) - before, toFils('6000.00'));
  });

  test('a loan: Dr bank, Cr Due to owner; drawings: Dr Owner’s drawings, Cr cash', async () => {
    const loan = await recordOwnerMoney(a.owner, {
      kind: 'LOAN_IN',
      accountId: roles.BANK,
      amount: '1000',
      movedOn: today(),
    });
    const lent = await bookedFor(loan.id);
    assert.equal(lent.get(roles.BANK), toFils('1000.00'));
    assert.equal(lent.get(roles.OWNER_ADVANCES), -toFils('1000.00'));
    const drawn = await recordOwnerMoney(a.owner, {
      kind: 'DRAWINGS',
      accountId: roles.CASH,
      amount: '500',
      movedOn: today(),
    });
    const out = await bookedFor(drawn.id);
    assert.equal(out.get(roles.OWNER_DRAWINGS), toFils('500.00'));
    assert.equal(out.get(roles.CASH), -toFils('500.00'));
  });

  test('only the workshop’s own cash, petty cash or bank; never a future date', async () => {
    await expectDomainError(
      recordOwnerMoney(a.owner, {
        kind: 'CAPITAL_IN',
        accountId: roles.CARD_CLEARING,
        amount: '10',
        movedOn: today(),
      }),
      /cash, petty cash or bank/,
    );
    await expectDomainError(
      recordOwnerMoney(a.owner, {
        kind: 'CAPITAL_IN',
        accountId: roles.CASH,
        amount: '10',
        movedOn: localDateString(new Date(Date.now() + 2 * 86_400_000)),
      }),
      /not a future one/,
    );
    // The partner named must be one of the workshop's partners.
    await expectDomainError(
      recordOwnerMoney(a.owner, {
        kind: 'CAPITAL_IN',
        accountId: roles.CASH,
        partnerId: '00000000-0000-7000-8000-000000000000',
        amount: '10',
        movedOn: today(),
      }),
      /partner from the list/,
    );
    const viewer = { ...a.owner, orgWidePermissions: new Set(['money.view']) };
    await assert.rejects(
      recordOwnerMoney(viewer, {
        kind: 'CAPITAL_IN',
        accountId: roles.CASH,
        amount: '10',
        movedOn: today(),
      }),
      AuthError,
    );
  });

  test('voided: kept on record, its entry reversed; the list shows both entries', async () => {
    const row = await recordOwnerMoney(a.owner, {
      kind: 'CAPITAL_IN',
      accountId: roles.CASH,
      amount: '250',
      movedOn: today(),
    });
    await voidOwnerMoney(a.owner, row.id, { reason: 'Entered twice' });
    const booked = await bookedFor(row.id);
    assert.ok(
      [...booked.values()].every((value) => value === 0),
      'nothing stands',
    );
    const list = await listOwnerMoney(a.owner);
    const listed = list.rows.find((entry) => entry.id === row.id);
    assert.equal(listed?.status, 'VOID');
    assert.match(listed?.journalEntry ?? '', /^JV-/);
    assert.match(listed?.reversedBy ?? '', /^JV-/);
    assert.equal(list.totals.capitalIn, '6000.00', 'a void counts for nothing');
    assert.equal(list.totals.loansIn, '1000.00');
    assert.equal(list.totals.drawings, '500.00');
    await expectDomainError(voidOwnerMoney(a.owner, row.id, { reason: 'Again' }), /already void/);
  });

  test('three partners: each one’s money kept against their name, totalled per partner', async () => {
    const first = await addPartner(a.owner, { name: `Partner A ${RUN}` });
    const second = await addPartner(a.owner, { name: `Partner B ${RUN}` });
    const third = await addPartner(a.owner, { name: `Partner C ${RUN}` });
    await expectDomainError(
      addPartner(a.owner, { name: `partner a ${RUN}` }),
      /already a partner by that name/,
    );
    for (const [partner, amount] of [
      [first, '2000'],
      [second, '2000'],
      [third, '2000'],
    ] as const) {
      await recordOwnerMoney(a.owner, {
        kind: 'CAPITAL_IN',
        accountId: roles.CASH,
        partnerId: partner.id,
        amount,
        movedOn: today(),
      });
    }
    await recordOwnerMoney(a.owner, {
      kind: 'DRAWINGS',
      accountId: roles.CASH,
      partnerId: first.id,
      amount: '300',
      movedOn: today(),
    });
    const list = await listOwnerMoney(a.owner);
    const of = (id: string) => list.partners.find((partner) => partner.id === id);
    assert.equal(of(first.id)?.capitalIn, '2000.00');
    assert.equal(of(first.id)?.drawings, '300.00');
    assert.equal(of(first.id)?.net, '1700.00');
    assert.equal(of(second.id)?.net, '2000.00');
    assert.equal(of(third.id)?.net, '2000.00');
    const row = list.rows.find((entry) => entry.partner?.id === second.id);
    assert.equal(row?.partner?.name, `Partner B ${RUN}`);
    // The journal names the partner.
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { organizationId: a.organizationId, sourceType: 'OWNER_MONEY', sourceId: row!.id },
    });
    assert.match(entry.description ?? '', /Partner B/);
  });

  test('the books balance and nothing is left unbooked', async () => {
    assert.equal((await getBalanceSheet(a.owner)).balanced, true);
    assert.equal(await countUnbooked(a.owner), 0);
  });
});
