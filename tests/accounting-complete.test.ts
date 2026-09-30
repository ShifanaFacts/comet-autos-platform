/**
 * Integration tests for the rest of the books:
 *
 *  - tax credit notes: a full credit mirrors the invoice to the fil (its bill
 *    discount and VAT too) and its entry undoes the invoice's; money paid
 *    beyond what is due is refunded; nothing can be credited twice or beyond
 *    what it was sold for; a credited invoice can no longer be edited or
 *    voided; a void credit note puts everything back;
 *  - the VAT return: lines reported by treatment, credit notes taking their
 *    part off the period they are issued in, Box 1 against the emirate;
 *  - statements of account agree with what is owed;
 *  - bank reconciliation completes only when the ticked lines agree with the
 *    statement, and follows on from the last one;
 *  - fixed assets: bought, depreciated monthly (never twice, never a month
 *    that has not ended), sold with a gain or loss; one brought in from
 *    before the books; one recorded in error removed;
 *  - a bill is kept only if it really is a photo or a PDF;
 *  - everything balances and nothing is left unbooked.
 *
 * Every record is made in a throwaway test organization. Needs the
 * 20260929090000_accounting_complete migration applied.
 *
 *   npm run test:integration
 */
import 'dotenv/config';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AccountRole } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { createDirectInvoice } from '@/lib/billing/direct-invoice';
import { recordInvoicePayment } from '@/lib/billing/invoice';
import { reverseInvoicePayment, updateInvoice, voidInvoice } from '@/lib/billing/invoice-changes';
import {
  createCreditNote,
  getCreditableInvoice,
  recordCreditNoteRefund,
  voidCreditNote,
} from '@/lib/billing/credit-notes';
import { getVatReturn } from '@/lib/finance/vat';
import { getCustomerStatement } from '@/lib/finance/statements';
import { recordExpense } from '@/lib/finance/expenses';
import { attachExpenseBill, listExpenseBills } from '@/lib/finance/expense-bills';
import { updateOrganizationSettings } from '@/lib/organization/settings';
import { ensureChart } from '@/lib/accounting/chart';
import { bookExistingRecords, countUnbooked } from '@/lib/accounting/entries';
import { getBalanceSheet, getTrialBalance } from '@/lib/accounting/reports';
import {
  completeReconciliation,
  getReconciliation,
  reopenReconciliation,
  setReconciledLines,
  startReconciliation,
} from '@/lib/accounting/reconciliation';
import {
  createFixedAsset,
  deleteFixedAsset,
  disposeFixedAsset,
  getFixedAsset,
  lastEndedMonth,
  runDepreciation,
} from '@/lib/accounting/fixed-assets';
import { monthIndex } from '@/lib/accounting/depreciation';
import { filsToString, toFils } from '@/lib/money';
import { localDateString, toLocalDateTimeInput } from '@/lib/format';
import { createTestOrg, expectDomainError, RUN, type TestOrg } from './support';

let a: TestOrg;
let roles: Record<AccountRole, string>;

before(async () => {
  a = await createTestOrg('Books');
  roles = await prisma.$transaction((tx) => ensureChart(tx, a.organizationId));
});

after(async () => {
  await prisma.$disconnect();
});

const today = () => localDateString();
const daysAgo = (days: number) => localDateString(new Date(Date.now() - days * 86400000));
const now = () => toLocalDateTimeInput(new Date());
const money = (value: { toString(): string }) => filsToString(toFils(value.toString()));

async function customer(suffix: string) {
  return prisma.customer.create({
    data: {
      organizationId: a.organizationId,
      name: `Books Customer ${suffix} ${RUN}`,
      phone: `050 ${suffix.padStart(3, '0')} 7755`,
    },
  });
}

/** Net debit per account, in fils, over the entries booking these records. */
async function bookedFor(...sourceIds: string[]) {
  const lines = await prisma.journalEntryLine.findMany({
    where: { organizationId: a.organizationId, journalEntry: { sourceId: { in: sourceIds } } },
    select: { chartOfAccountId: true, debitAmount: true, creditAmount: true },
  });
  const net = new Map<string, number>();
  for (const line of lines) {
    const value = toFils(line.debitAmount.toString()) - toFils(line.creditAmount.toString());
    net.set(line.chartOfAccountId, (net.get(line.chartOfAccountId) ?? 0) + value);
  }
  return net;
}

/** Credits every line of an invoice in full. */
async function creditEverything(invoiceId: string, reason: string) {
  const creditable = await getCreditableInvoice(a.owner, invoiceId);
  return createCreditNote(a.owner, invoiceId, {
    reason,
    lines: creditable.lines.map((line) => ({ invoiceItemId: line.id, amount: line.remaining })),
  });
}

describe('tax credit notes', () => {
  let paidInvoiceId: string;
  let paidCustomerId: string;

  test('a full credit mirrors a discounted invoice to the fil, and its entry undoes the invoice', async () => {
    const { id: customerId } = await customer('20');
    paidCustomerId = customerId;
    // Lines 400 + 2 × 50 = 500, bill discount 10, taxable 490, VAT 24.50, total 514.50.
    const { invoiceId, paymentId } = await createDirectInvoice(a.owner, {
      customerId,
      items: [
        { itemType: 'LABOUR', description: 'Service', quantity: '1', unitPrice: '400' },
        { itemType: 'PART', description: 'Oil filter', quantity: '2', unitPrice: '50' },
      ],
      discountType: 'AMOUNT',
      discount: '10',
      payNow: '1',
      paymentMethod: 'CASH',
    });
    paidInvoiceId = invoiceId;

    const note = await creditEverything(invoiceId, 'Job redone under warranty');
    assert.equal(note.totalAmount, '514.50');
    assert.equal(note.refundAmount, '514.50', 'it was paid, so all of it goes back');
    assert.match(note.creditNoteNumber, /^CN-/);

    const stored = await prisma.creditNote.findUniqueOrThrow({ where: { id: note.creditNoteId } });
    assert.equal(money(stored.discountAmount), '10.00', 'the bill discount comes back with it');
    assert.equal(money(stored.subtotal), '490.00');
    assert.equal(money(stored.taxAmount), '24.50');

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    assert.equal(money(invoice.creditedAmount), '514.50');
    assert.equal(invoice.status, 'PAID', 'nothing is due');

    // Sales, discount and VAT all net to nothing across invoice and credit note.
    const net = await bookedFor(invoiceId, note.creditNoteId);
    for (const role of ['SALES_LABOUR', 'SALES_PARTS', 'SALES_DISCOUNTS', 'VAT_OUTPUT'] as const) {
      assert.equal(net.get(roles[role]) ?? 0, 0, `${role} is undone`);
    }
    // Paid 514.50, credited 514.50: the customer is owed it until it is refunded.
    const owed = await bookedFor(invoiceId, paymentId!, note.creditNoteId);
    assert.equal(owed.get(roles.ACCOUNTS_RECEIVABLE), -toFils('514.50'));

    await recordCreditNoteRefund(a.owner, note.creditNoteId, {
      refundedOn: today(),
      method: 'CASH',
    });
    const settled = await bookedFor(invoiceId, paymentId!, note.creditNoteId);
    assert.equal(settled.get(roles.ACCOUNTS_RECEIVABLE), 0);
    assert.equal(settled.get(roles.CASH), 0, 'the cash came in and went back');
    await expectDomainError(
      recordCreditNoteRefund(a.owner, note.creditNoteId, { refundedOn: today(), method: 'CASH' }),
      /already been recorded/,
    );
  });

  test('a credited invoice stands: no second full credit, no edit, no void, no payment reversal', async () => {
    await expectDomainError(creditEverything(paidInvoiceId, 'Again'), /credited in full/);
    await expectDomainError(
      updateInvoice(a.owner, paidInvoiceId, {
        items: [{ itemType: 'LABOUR', description: 'x', quantity: '1', unitPrice: '1' }],
      }),
      /credit note/,
    );
    await expectDomainError(
      voidInvoice(a.owner, paidInvoiceId, { reason: 'Mistake' }),
      /credit note/,
    );
    const payment = await prisma.payment.findFirstOrThrow({ where: { invoiceId: paidInvoiceId } });
    await expectDomainError(
      reverseInvoicePayment(a.owner, payment.id, { reason: 'Mistake' }),
      /refunded/,
    );
  });

  test('a partial credit reduces what is due; never beyond the line; a void puts it back', async () => {
    const { id: customerId } = await customer('21');
    const { invoiceId } = await createDirectInvoice(a.owner, {
      customerId,
      items: [{ itemType: 'LABOUR', description: 'Diagnosis', quantity: '1', unitPrice: '100' }],
    });
    const [line] = (await getCreditableInvoice(a.owner, invoiceId)).lines;

    await expectDomainError(
      createCreditNote(a.owner, invoiceId, {
        reason: 'Too much',
        lines: [{ invoiceItemId: line.id, amount: '100.01' }],
      }),
      /only 100\.00 is left/,
    );
    const first = await createCreditNote(a.owner, invoiceId, {
      reason: 'Agreed discount after the job',
      lines: [{ invoiceItemId: line.id, amount: '50' }],
    });
    assert.equal(first.totalAmount, '52.50');
    assert.equal(first.refundAmount, '0.00', 'unpaid: nothing to refund');
    let invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    assert.equal(money(invoice.creditedAmount), '52.50');
    assert.equal(invoice.status, 'ISSUED');

    const [left] = (await getCreditableInvoice(a.owner, invoiceId)).lines;
    assert.equal(left.remaining, '50.00');
    assert.equal(left.remainingTax, '2.50');

    // The customer pays what is left; it is exactly the rest.
    await recordInvoicePayment(a.owner, invoiceId, {
      amount: '52.50',
      method: 'BANK_TRANSFER',
      receivedAt: now(),
    });
    invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    assert.equal(invoice.status, 'PAID');

    await voidCreditNote(a.owner, first.creditNoteId, { reason: 'Issued in error' });
    invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    assert.equal(money(invoice.creditedAmount), '0.00');
    assert.equal(invoice.status, 'PARTIALLY_PAID', 'owed again in full');
    const net = await bookedFor(first.creditNoteId);
    assert.ok(
      [...net.values()].every((value) => value === 0),
      'its entry is reversed',
    );

    const statement = await getCustomerStatement(a.owner, customerId);
    assert.equal(statement.closing, '52.50', 'the statement says what is owed');
    assert.equal(statement.totalDue, '52.50');
  });

  test("a customer's statement: invoice, payment, credit note and refund leave nothing owed", async () => {
    const statement = await getCustomerStatement(a.owner, paidCustomerId);
    assert.equal(statement.opening, '0.00');
    assert.deepEqual(statement.lines.map((line) => line.kind).sort(), [
      'Credit note',
      'Invoice',
      'Payment',
      'Refund',
    ]);
    assert.equal(statement.closing, '0.00');
    assert.equal(statement.totalDebits, statement.totalCredits);
  });
});

describe('the VAT return', () => {
  test('each treatment in its box, a credit note taking its part off this period', async () => {
    const { id: customerId } = await customer('30');
    const before = (await getVatReturn(a.owner, { period: 'month' })).boxes;
    const { invoiceId } = await createDirectInvoice(a.owner, {
      customerId,
      items: [
        { itemType: 'LABOUR', description: 'Service', quantity: '1', unitPrice: '200' },
        {
          itemType: 'LABOUR',
          description: 'Export recovery',
          quantity: '1',
          unitPrice: '100',
          vatTreatment: 'ZERO_RATED',
        },
        {
          itemType: 'LABOUR',
          description: 'Traffic fine paid on the customer’s behalf',
          quantity: '1',
          unitPrice: '30',
          vatTreatment: 'OUT_OF_SCOPE',
        },
      ],
    });
    const mid = (await getVatReturn(a.owner, { period: 'month' })).boxes;
    const diff = (x: string, y: string) => filsToString(toFils(x) - toFils(y));
    assert.equal(diff(mid.standardSupplies, before.standardSupplies), '200.00');
    assert.equal(diff(mid.zeroRatedSupplies, before.zeroRatedSupplies), '100.00');
    assert.equal(diff(mid.outOfScopeSupplies, before.outOfScopeSupplies), '30.00');
    assert.equal(diff(mid.outputVat, before.outputVat), '10.00');
    assert.equal(diff(mid.totalSupplies, before.totalSupplies), '300.00', 'out of scope left off');

    const lines = (await getCreditableInvoice(a.owner, invoiceId)).lines;
    const service = lines.find((line) => line.description === 'Service')!;
    await createCreditNote(a.owner, invoiceId, {
      reason: 'Part of the service not done',
      lines: [{ invoiceItemId: service.id, amount: '40' }],
    });
    const after = await getVatReturn(a.owner, { period: 'month' });
    assert.equal(diff(mid.standardSupplies, after.boxes.standardSupplies), '40.00');
    assert.equal(diff(mid.outputVat, after.boxes.outputVat), '2.00');
    assert.ok(after.credits.some((row) => row.invoiceId === invoiceId));
    assert.equal(after.emirate.box, '1b', 'Dubai by default');

    await updateOrganizationSettings(a.owner, {
      name: `Test Books ${RUN}`,
      isVatRegistered: 'true',
      vatRate: '5',
      emirate: 'SHARJAH',
    });
    assert.equal((await getVatReturn(a.owner, { period: 'month' })).emirate.box, '1c');
  });
});

describe('fixed assets', () => {
  let assetId: string;

  test('bought from the bank, booked at cost', async () => {
    const created = await createFixedAsset(a.owner, {
      name: `Two-post lift ${RUN}`,
      assetAccountId: (await code('1500')).id,
      accumulatedAccountId: (await code('1590')).id,
      expenseAccountId: (await code('5800')).id,
      acquiredOn: daysAgo(95),
      cost: '12000',
      residualValue: '0',
      usefulLifeMonths: '12',
      funding: 'PAID',
      paidFromAccountId: roles.BANK,
    });
    assetId = created.fixedAssetId;
    assert.match(created.assetNumber, /^FA-/);
    const booked = await bookedFor(assetId);
    assert.equal(booked.get((await code('1500')).id), toFils('12000.00'));
    assert.equal(booked.get(roles.BANK), -toFils('12000.00'));
  });

  test('depreciated month by month up to the last month ended, never twice', async () => {
    const acquired = monthIndex(new Date(`${daysAgo(95)}T00:00:00Z`));
    const [year, month] = lastEndedMonth().split('-').map(Number);
    const expected = year * 12 + month - 1 - acquired;

    await expectDomainError(runDepreciation(a.owner, { throughMonth: '2999-01' }), /has not ended/);
    const first = await runDepreciation(a.owner, { throughMonth: lastEndedMonth() });
    assert.deepEqual(first.failed, []);
    assert.equal(first.charged, expected);
    const second = await runDepreciation(a.owner, { throughMonth: lastEndedMonth() });
    assert.equal(second.charged, 0, 'nothing is charged twice');

    const asset = await getFixedAsset(a.owner, assetId);
    assert.equal(asset.accumulated, filsToString(expected * 100000), '1000.00 a month');
    assert.equal(asset.bookValue, filsToString(1200000 - expected * 100000));
  });

  test('sold: cost and depreciation leave the books, the difference is a gain', async () => {
    const before = await getFixedAsset(a.owner, assetId);
    await disposeFixedAsset(a.owner, assetId, {
      disposedOn: today(),
      proceeds: '11500',
      proceedsAccountId: roles.BANK,
    });
    const after = await getFixedAsset(a.owner, assetId);
    assert.equal(after.status, 'DISPOSED');
    const gain = toFils('11500.00') - toFils(after.bookValue);
    assert.equal(after.gainOnDisposal, filsToString(gain));

    const booked = await bookedFor(assetId, ...after.depreciations.map((row) => row.id));
    assert.equal(booked.get((await code('1500')).id), 0, 'the cost is gone');
    assert.equal(booked.get((await code('1590')).id), 0, 'and its depreciation');
    assert.equal(booked.get(roles.ASSET_DISPOSALS), -gain, 'a gain is a credit');
    assert.ok(toFils(before.bookValue) >= toFils(after.bookValue));
    await expectDomainError(
      disposeFixedAsset(a.owner, assetId, { disposedOn: today(), proceeds: '0' }),
      /already been disposed/,
    );
  });

  test('owned before the books: brought in at cost less the depreciation already charged', async () => {
    const created = await createFixedAsset(a.owner, {
      name: `Recovery van ${RUN}`,
      assetAccountId: (await code('1510')).id,
      accumulatedAccountId: (await code('1590')).id,
      expenseAccountId: (await code('5800')).id,
      acquiredOn: daysAgo(730),
      cost: '10000',
      usefulLifeMonths: '60',
      funding: 'OPENING',
      openingThrough: daysAgo(60),
      openingDepreciation: '4000',
    });
    const booked = await bookedFor(created.fixedAssetId);
    assert.equal(booked.get((await code('1510')).id), toFils('10000.00'));
    assert.equal(booked.get(roles.OPENING_BALANCE), -toFils('6000.00'));
    assert.equal(booked.get((await code('1590')).id), -toFils('4000.00'));
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { sourceId: created.fixedAssetId },
    });
    assert.equal(entry.entryDate.toISOString().slice(0, 10), daysAgo(60), 'on the take-over day');
  });

  test('one recorded in error is removed while nothing is charged on it', async () => {
    const created = await createFixedAsset(a.owner, {
      name: `Typo ${RUN}`,
      assetAccountId: (await code('1530')).id,
      accumulatedAccountId: (await code('1590')).id,
      expenseAccountId: (await code('5800')).id,
      acquiredOn: today(),
      cost: '999',
      usefulLifeMonths: '36',
      funding: 'PAID',
    });
    await deleteFixedAsset(a.owner, created.fixedAssetId);
    const net = await bookedFor(created.fixedAssetId);
    assert.ok(
      [...net.values()].every((value) => value === 0),
      'its entry is reversed',
    );
    await expectDomainError(deleteFixedAsset(a.owner, assetId), /stays in the register/);
  });
});

describe('bank reconciliation', () => {
  test('completes only when the ticked lines agree with the statement, and follows on', async () => {
    const { id: customerId } = await customer('40');
    const { invoiceId } = await createDirectInvoice(a.owner, {
      customerId,
      items: [{ itemType: 'LABOUR', description: 'Alignment', quantity: '1', unitPrice: '200' }],
    });
    await recordInvoicePayment(a.owner, invoiceId, {
      amount: '210',
      method: 'BANK_TRANSFER',
      receivedAt: now(),
      accountId: roles.BANK,
    });
    const sum = await prisma.journalEntryLine.aggregate({
      where: {
        organizationId: a.organizationId,
        chartOfAccountId: roles.BANK,
        journalEntry: { entryDate: { lte: new Date(`${today()}T00:00:00Z`) } },
      },
      _sum: { debitAmount: true, creditAmount: true },
    });
    const balance =
      toFils(sum._sum.debitAmount?.toString() ?? '0') -
      toFils(sum._sum.creditAmount?.toString() ?? '0');
    const statementBalance = balance < 0 ? `-${filsToString(-balance)}` : filsToString(balance);

    const { reconciliationId } = await startReconciliation(a.owner, {
      accountId: roles.BANK,
      statementDate: today(),
      statementBalance,
    });
    await expectDomainError(
      startReconciliation(a.owner, {
        accountId: roles.BANK,
        statementDate: today(),
        statementBalance,
      }),
      /already in progress/,
    );
    await expectDomainError(completeReconciliation(a.owner, reconciliationId), /difference/);

    const detail = await getReconciliation(a.owner, reconciliationId);
    assert.ok(detail.rows.length > 0);
    await setReconciledLines(a.owner, reconciliationId, {
      lineIds: detail.rows.map((row) => row.id),
      ticked: true,
    });
    const ticked = await getReconciliation(a.owner, reconciliationId);
    assert.equal(ticked.differenceFils, 0);
    assert.equal(ticked.clearedBalance, statementBalance);
    await completeReconciliation(a.owner, reconciliationId);

    // The next one starts from this statement, and must be later.
    await expectDomainError(
      startReconciliation(a.owner, {
        accountId: roles.BANK,
        statementDate: today(),
        statementBalance,
      }),
      /already reconciled/,
    );
    await expectDomainError(
      startReconciliation(a.owner, {
        accountId: roles.SALES_LABOUR,
        statementDate: today(),
        statementBalance: '0',
      }),
      /cash, bank or card/,
    );
    await reopenReconciliation(a.owner, reconciliationId);
    await completeReconciliation(a.owner, reconciliationId);
  });
});

describe('supplier bills', () => {
  test('only a real photo or PDF is kept', async () => {
    const expense = await recordExpense(a.owner, {
      description: `Electricity ${RUN}`,
      amount: '300',
      taxRate: '5',
      expenseDate: today(),
      paymentMethod: 'BANK_TRANSFER',
    });
    await expectDomainError(
      attachExpenseBill(a.owner, expense.id, {
        name: 'bill.pdf',
        bytes: Buffer.from('this is not a pdf'),
      }),
      /isn’t a photo/,
    );
    assert.equal((await listExpenseBills(a.owner, [expense.id])).size, 0);
  });
});

describe('the books', () => {
  test('balance, and nothing is left unbooked', async () => {
    const entries = await prisma.journalEntry.findMany({
      where: { organizationId: a.organizationId },
      include: { lines: true },
    });
    for (const entry of entries) {
      const debit = entry.lines.reduce((s, l) => s + toFils(l.debitAmount.toString()), 0);
      const credit = entry.lines.reduce((s, l) => s + toFils(l.creditAmount.toString()), 0);
      assert.equal(debit, credit, `${entry.entryNumber} balances`);
    }
    assert.equal((await getTrialBalance(a.owner)).balanced, true);
    assert.equal((await getBalanceSheet(a.owner)).balanced, true);
    assert.equal(await countUnbooked(a.owner), 0);
    const run = await bookExistingRecords(a.owner);
    assert.equal(run.booked, 0);
    assert.deepEqual(run.failed, []);
  });
});

async function code(accountCode: string) {
  return prisma.chartOfAccount.findFirstOrThrow({
    where: { organizationId: a.organizationId, accountCode },
    select: { id: true },
  });
}
