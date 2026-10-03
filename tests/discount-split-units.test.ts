/**
 * Unit tests for splitting a discount given after an invoice across its
 * lines (lib/billing/credit-notes.ts splitDiscount): VAT included, exact to
 * the fil, never more than is left on a line.
 *
 *   npm run test:unit
 */
import './unit-env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { creditableLines, splitDiscount } from '@/lib/billing/credit-notes';
import { billDiscountBreakdown, calculateLine } from '@/lib/money';

/** An invoice line as stored, priced the usual way. */
function line(id: string, price: string, rate = '5') {
  const amounts = calculateLine({ quantity: '1', unitPrice: price, taxRate: rate });
  return {
    id,
    itemType: 'LABOUR' as const,
    description: id,
    quantity: '1',
    unitPrice: price,
    lineTotal: amounts.lineTotal,
    taxRate: rate,
    taxAmount: amounts.taxAmount,
    vatTreatment: 'STANDARD' as const,
    accountId: null,
  };
}

/** What a split comes to with VAT, as the credit note will price it. */
function totalOf(split: NonNullable<ReturnType<typeof splitDiscount>>) {
  return split.reduce((sum, { line: l, amount }) => {
    const rate = Math.round(Number(l.item.taxRate) * 100);
    const tax =
      amount === l.remaining
        ? l.remainingTax
        : Math.min(Math.round((amount * rate) / 10000), l.remainingTax);
    return sum + amount + tax;
  }, 0);
}

describe('a discount after the invoice', () => {
  // Labour 1,480 + parts 2,000, VAT 5%: total 3,654 — INV-000009's figures.
  const lines = creditableLines(
    { discountAmount: '0', items: [line('labour', '1480'), line('parts', '2000')] },
    new Map(),
  );

  test('154.00 splits exactly: 146.67 before VAT, 7.33 VAT', () => {
    const split = splitDiscount(lines, 15400);
    assert.ok(split);
    assert.equal(totalOf(split), 15400);
    assert.equal(
      split.reduce((sum, entry) => sum + entry.amount, 0),
      14667,
    );
  });

  test('every amount from 0.01 to the whole invoice comes out exact', () => {
    for (let target = 1; target <= 365400; target += 97) {
      const split = splitDiscount(lines, target);
      assert.ok(split, String(target));
      assert.equal(totalOf(split), target, String(target));
      for (const entry of split) assert.ok(entry.amount <= entry.line.remaining);
    }
  });

  test('the whole of what is left credits every line in full', () => {
    const split = splitDiscount(lines, 365400);
    assert.deepEqual(
      split?.map((entry) => entry.amount),
      [148000, 200000],
    );
  });

  test('mixed rates: a zero-rated line alongside a standard one', () => {
    const mixed = creditableLines(
      { discountAmount: '0', items: [line('std', '333.33'), line('zero', '120', '0')] },
      new Map(),
    );
    for (const target of [1, 99, 1000, 4567, 12345, 45000]) {
      const split = splitDiscount(mixed, target);
      assert.ok(split, String(target));
      assert.equal(totalOf(split), target, String(target));
    }
  });
});

describe('a discount on the bill, as the customer reads it', () => {
  test('INV-000009: 3,654.00 − 154.00 (146.68 + VAT 7.32) = 3,500.00', () => {
    const breakdown = billDiscountBreakdown({
      discountAmount: '146.68',
      subtotal: '3333.32',
      taxAmount: '166.68',
      items: [
        { lineTotal: '1180', taxRate: '5' },
        { lineTotal: '2300', taxRate: '5' },
      ],
    });
    assert.deepEqual(breakdown, {
      linesTotal: '3480.00',
      vatBefore: '174.00',
      totalBefore: '3654.00',
      discount: '146.68',
      vatSaved: '7.32',
      discountWithVat: '154.00',
    });
  });

  test('no discount on the bill, no breakdown', () => {
    assert.equal(
      billDiscountBreakdown({ discountAmount: '0', subtotal: '100', taxAmount: '5', items: [] }),
      null,
    );
  });
});
