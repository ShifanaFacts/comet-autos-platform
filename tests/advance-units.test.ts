/**
 * Unit tests for the invoice balance rule with customer advances, and an
 * advance's own figures:
 *
 *  - an invoice with no advance applied has exactly the balance and status
 *    it had before advances existed (total − credited − paid);
 *  - an advance applied comes off what is due, like a payment, and makes an
 *    invoice part-settled;
 *  - what is left on an advance, money returned to it by a credit note
 *    included, and the status that follows.
 *
 *   npm run test:unit
 */
import './unit-env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { dueFils, invoiceBalance, receiptBalances, settlementStatus } from '@/lib/billing/invoice';
import { advanceFigures, advanceStatusFor } from '@/lib/billing/advances';
import { toFils } from '@/lib/money';

const payment = (id: string, amount: string, minute: number) => ({
  id,
  amount,
  status: 'COMPLETED',
  reversalOfPaymentId: null,
  receivedAt: new Date(Date.UTC(2026, 9, 1, 8, minute)),
});

describe('an invoice with no advance applied is exactly as before', () => {
  const samples = [
    { total: '1050.00', credited: '0', paid: 0 },
    { total: '1050.00', credited: '0', paid: toFils('400') },
    { total: '1050.00', credited: '105.00', paid: toFils('945') },
    { total: '514.50', credited: '514.50', paid: 0 },
    { total: '99.99', credited: '0', paid: toFils('99.99') },
    { total: '200.00', credited: '50.00', paid: toFils('250') },
  ];

  test('due = total − credited − paid, never below zero', () => {
    for (const sample of samples) {
      const old = Math.max(toFils(sample.total) - toFils(sample.credited) - sample.paid, 0);
      const invoice = {
        totalAmount: sample.total,
        creditedAmount: sample.credited,
        advanceAppliedAmount: '0',
      };
      assert.equal(dueFils(invoice, sample.paid), old, JSON.stringify(sample));
    }
  });

  test('status: paid once nothing is due, part paid once anything is paid, else issued', () => {
    for (const sample of samples) {
      const invoice = {
        totalAmount: sample.total,
        creditedAmount: sample.credited,
        advanceAppliedAmount: '0',
      };
      const old =
        Math.max(toFils(sample.total) - toFils(sample.credited) - sample.paid, 0) === 0
          ? 'PAID'
          : sample.paid > 0
            ? 'PARTIALLY_PAID'
            : 'ISSUED';
      assert.equal(settlementStatus(invoice, sample.paid), old, JSON.stringify(sample));
    }
  });
});

describe('an advance applied', () => {
  test('comes off what is due, like a payment', () => {
    const invoice = { totalAmount: '1050', creditedAmount: '0', advanceAppliedAmount: '600' };
    assert.equal(dueFils(invoice, 0), toFils('450'));
    assert.equal(dueFils(invoice, toFils('450')), 0);
    assert.equal(dueFils(invoice, toFils('500')), 0, 'never below zero');
  });

  test('part-settles the invoice even with nothing paid; settles it with the rest', () => {
    assert.equal(
      settlementStatus(
        { totalAmount: '1050', creditedAmount: '0', advanceAppliedAmount: '600' },
        0,
      ),
      'PARTIALLY_PAID',
    );
    assert.equal(
      settlementStatus(
        { totalAmount: '1050', creditedAmount: '0', advanceAppliedAmount: '1050' },
        0,
      ),
      'PAID',
    );
    assert.equal(
      settlementStatus(
        { totalAmount: '525', creditedAmount: '105', advanceAppliedAmount: '395' },
        toFils('25'),
      ),
      'PAID',
    );
  });

  test('is shown on its own line, apart from what was paid', () => {
    const balance = invoiceBalance({
      totalAmount: '525.00',
      creditedAmount: '0',
      advanceAppliedAmount: '500.00',
      status: 'PARTIALLY_PAID',
      payments: [payment('p1', '20.00', 1)],
    });
    assert.equal(balance.paid, '20.00');
    assert.equal(balance.advanceApplied, '500.00');
    assert.equal(balance.balance, '5.00');
  });

  test('comes off before the payments on a receipt', () => {
    const invoice = {
      totalAmount: '525.00',
      creditedAmount: '0',
      advanceAppliedAmount: '500.00',
      payments: [payment('p1', '10.00', 1), payment('p2', '15.00', 2)],
    };
    assert.deepEqual(receiptBalances(invoice, 'p2'), {
      previousBalance: '15.00',
      remainingBalance: '0.00',
      paidToDate: '25.00',
    });
  });
});

describe('an advance’s own figures', () => {
  const row = (amount: string, reversed = false) => ({
    amount,
    reversedAt: reversed ? new Date() : null,
  });

  test('left = received − applied (less returned) − refunded, undone rows ignored', () => {
    const figures = advanceFigures({
      amount: '2000.00',
      allocations: [row('600.00'), row('450.00', true), row('300.00'), row('-105.00')],
      refunds: [row('250.00'), row('100.00', true)],
    });
    assert.deepEqual(figures, {
      amount: toFils('2000'),
      applied: toFils('795'),
      refunded: toFils('250'),
      left: toFils('955'),
    });
  });

  test('status follows the figures', () => {
    assert.equal(advanceStatusFor(2000_00, 0, 0), 'OPEN');
    assert.equal(advanceStatusFor(2000_00, 600_00, 0), 'PARTIALLY_APPLIED');
    assert.equal(advanceStatusFor(2000_00, 0, 500_00), 'PARTIALLY_APPLIED');
    assert.equal(advanceStatusFor(2000_00, 2000_00, 0), 'FULLY_APPLIED');
    assert.equal(advanceStatusFor(2000_00, 1500_00, 500_00), 'REFUNDED');
    assert.equal(advanceStatusFor(2000_00, 0, 2000_00), 'REFUNDED');
  });
});
