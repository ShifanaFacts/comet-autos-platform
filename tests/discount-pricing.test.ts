/**
 * The discount rules in lib/money — pure arithmetic, no database:
 *
 *  - a line's own discount, as a percentage or a fixed amount;
 *  - a discount on the whole bill, shared across the lines so each line's
 *    VAT is worked out on what the customer actually pays;
 *  - nothing changes for a document without discounts.
 *
 *   npm run test:unit
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDocument,
  calculateLine,
  calculateTotals,
  prorateFils,
  readDiscount,
  toFils,
} from '@/lib/money';

describe('line discounts', () => {
  test('a line without a discount prices exactly as before', () => {
    const line = calculateLine({ quantity: '2', unitPrice: '100', taxRate: '5' });
    assert.equal(line.lineTotal, '200.00');
    assert.equal(line.taxAmount, '10.00');
    assert.equal(line.discountAmount, '0.00');
    assert.equal(line.discountType, null);
    assert.equal(line.discountValue, null);
  });

  test('a percentage comes off the line before VAT', () => {
    const line = calculateLine({
      quantity: '1',
      unitPrice: '350',
      taxRate: '5',
      discount: { type: 'PERCENT', value: '10' },
    });
    assert.equal(line.discountAmount, '35.00');
    assert.equal(line.lineTotal, '315.00');
    assert.equal(line.taxAmount, '15.75');
    assert.equal(line.discountValue, '10.00');
  });

  test('a fixed amount comes off the line', () => {
    const line = calculateLine({
      quantity: '3',
      unitPrice: '33.33',
      taxRate: '5',
      discount: { type: 'AMOUNT', value: '25' },
    });
    assert.equal(line.discountAmount, '25.00');
    assert.equal(line.lineTotal, '74.99');
  });

  test('a discount can take a line to zero, never below', () => {
    const free = calculateLine({
      quantity: '1',
      unitPrice: '80',
      taxRate: '5',
      discount: { type: 'PERCENT', value: '100' },
    });
    assert.equal(free.lineTotal, '0.00');
    assert.equal(free.taxAmount, '0.00');
    assert.throws(
      () =>
        calculateLine({
          quantity: '1',
          unitPrice: '10',
          taxRate: '5',
          discount: { type: 'AMOUNT', value: '10.01' },
        }),
      /cannot be more than the amount/,
    );
    assert.throws(
      () =>
        calculateLine({
          quantity: '1',
          unitPrice: '10',
          taxRate: '5',
          discount: { type: 'PERCENT', value: '100.5' },
        }),
      /cannot exceed 100%/,
    );
  });

  test('blank or zero means no discount; a negative one is refused', () => {
    assert.equal(readDiscount('PERCENT', ''), null);
    assert.equal(readDiscount('AMOUNT', '0.00'), null);
    assert.equal(readDiscount(undefined, '10'), null);
    assert.deepEqual(readDiscount('PERCENT', ' 12.5 '), { type: 'PERCENT', value: '12.5' });
    assert.throws(
      () =>
        calculateLine({
          quantity: '1',
          unitPrice: '10',
          taxRate: '5',
          discount: { type: 'AMOUNT', value: '-1' },
        }),
      /positive number/,
    );
  });
});

describe('bill discounts', () => {
  const lines = [
    calculateLine({ quantity: '1', unitPrice: '100', taxRate: '5' }),
    calculateLine({ quantity: '1', unitPrice: '200', taxRate: '0' }),
    calculateLine({ quantity: '1', unitPrice: '0.01', taxRate: '5' }),
  ];

  test('without one, the totals are the ones calculateTotals always gave', () => {
    const { totals } = calculateDocument(lines);
    const before = calculateTotals(lines);
    assert.equal(totals.subtotal, before.subtotal);
    assert.equal(totals.taxAmount, before.taxAmount);
    assert.equal(totals.totalAmount, before.totalAmount);
    assert.equal(totals.discountAmount, '0.00');
  });

  test('VAT is due on what is left after the discount, at each line’s own rate', () => {
    const { lines: priced, totals } = calculateDocument(lines, { type: 'AMOUNT', value: '10' });
    assert.deepEqual(totals, {
      linesTotal: '300.01',
      discountType: 'AMOUNT',
      discountValue: '10.00',
      discountAmount: '10.00',
      subtotal: '290.01',
      taxAmount: '4.83',
      totalAmount: '294.84',
    });
    // The 5% line keeps its share of 100/300.01 of the discount; the 0% line
    // pays no VAT whatever it is given.
    assert.deepEqual(
      priced.map((line) => line.taxAmount),
      ['4.83', '0.00', '0.00'],
    );
    // Line totals are what the customer sees on each line — unchanged.
    assert.deepEqual(
      priced.map((line) => line.lineTotal),
      ['100.00', '200.00', '0.01'],
    );
  });

  test('total = subtotal + VAT, and the VAT is the sum of the lines', () => {
    for (const value of ['1', '7.77', '33.33', '99.99', '100']) {
      const { lines: priced, totals } = calculateDocument(lines, { type: 'PERCENT', value });
      assert.equal(toFils(totals.totalAmount), toFils(totals.subtotal) + toFils(totals.taxAmount));
      assert.equal(
        toFils(totals.taxAmount),
        priced.reduce((sum, line) => sum + line.taxFils, 0),
      );
      assert.equal(
        toFils(totals.subtotal),
        toFils(totals.linesTotal) - toFils(totals.discountAmount),
      );
    }
  });

  test('a large bill still adds up to the fil', () => {
    const big = [
      calculateLine({ quantity: '1', unitPrice: '9999999.99', taxRate: '5' }),
      calculateLine({ quantity: '1', unitPrice: '7777777.77', taxRate: '5' }),
    ];
    const { lines: priced, totals } = calculateDocument(big, { type: 'PERCENT', value: '33.33' });
    assert.equal(
      toFils(totals.subtotal),
      toFils(totals.linesTotal) - toFils(totals.discountAmount),
    );
    assert.equal(
      toFils(totals.taxAmount),
      priced.reduce((sum, line) => sum + line.taxFils, 0),
    );
  });

  test('a bill discount larger than the bill is refused', () => {
    assert.throws(
      () => calculateDocument(lines, { type: 'AMOUNT', value: '300.02' }),
      /Bill discount cannot be more than the amount/,
    );
  });
});

describe('scaling a fixed amount', () => {
  test('rounds half-up, and never goes past the whole', () => {
    assert.equal(prorateFils(1000, 1, 3), 333);
    assert.equal(prorateFils(1000, 2, 3), 667);
    assert.equal(prorateFils(1000, 3, 3), 1000);
    assert.equal(prorateFils(1000, 5, 3), 1000);
    assert.equal(prorateFils(1000, 0, 3), 0);
    assert.equal(prorateFils(999_999_999_99, 123_456_789, 987_654_321), 12_499_999_886);
  });
});
