/**
 * Unit tests for valuing purchased stock (lib/inventory/purchase-value.ts)
 * and ageing supplier bills (payableAge):
 *
 *  - a line with no discount is valued exactly as before discounts existed,
 *    delivery by delivery and in total;
 *  - a discounted line's deliveries add up to its cost and VAT exactly, to
 *    the fil, however they are split — and a return takes off exactly what
 *    the units it gives back were booked at;
 *  - VAT is on the discounted amount;
 *  - a bill with no due date ages exactly as before; with one, from it.
 *
 *   npm run test:unit
 */
import './unit-env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  movementValue,
  receivedLineValue,
  receivedValueFils,
  unitCostAfterDiscount,
  type ValuedLine,
} from '@/lib/inventory/purchase-value';
import { payableAge } from '@/lib/finance/supplier-balance';
import {
  calculateDocument,
  calculateLine,
  filsToString,
  shareFils,
  toFils,
  toMilli,
} from '@/lib/money';

/** The old valuation, written out: quantity × cost at the line's rate. */
const oldValue = (milli: number, unitCost: string, rate: string) => {
  const amounts = calculateLine({
    quantity: (milli / 1000).toFixed(3),
    unitPrice: unitCost,
    taxRate: rate,
  });
  return { netFils: amounts.lineTotalFils, taxFils: amounts.taxFils };
};

const plain: ValuedLine = {
  quantityOrdered: '10.000',
  unitCost: '33.33',
  taxRate: '5.00',
  taxAmount: '16.67',
  netAmount: null,
};

describe('a line with no discount: exactly as before', () => {
  test('each delivery', () => {
    for (const milli of [1000, 3000, 3333, 6667, 10000]) {
      assert.deepEqual(
        movementValue({
          line: plain,
          movementMilli: milli,
          receivedBeforeMilli: 4000,
          unitCost: '33.33',
          taxRate: '5.00',
        }),
        oldValue(milli, '33.33', '5.00'),
        String(milli),
      );
    }
    // A return: the same, negative.
    const back = movementValue({
      line: plain,
      movementMilli: -2000,
      receivedBeforeMilli: 10000,
      unitCost: '33.33',
      taxRate: '5.00',
    });
    const two = oldValue(2000, '33.33', '5.00');
    assert.deepEqual(back, { netFils: -two.netFils, taxFils: -two.taxFils });
  });

  test('what has been received, for the supplier balance', () => {
    for (const received of ['0', '3.333', '7', '10']) {
      const value = receivedLineValue({ ...plain, quantityReceived: received }, '5');
      const expected =
        toMilli(received) > 0
          ? oldValue(toMilli(received), '33.33', '5.00')
          : { netFils: 0, taxFils: 0 };
      assert.deepEqual(value, expected, received);
    }
    // A line saved without a VAT rate uses the default, as before.
    const noRate = { ...plain, taxRate: null, quantityReceived: '2' };
    assert.deepEqual(receivedLineValue(noRate, '5'), oldValue(2000, '33.33', '5'));
  });
});

/** Prices lines with their own discounts and a bill discount, as the purchase service does. */
function priceDiscounted() {
  // 10 × 100.00 less 5% = 950.00; 3 × 33.33 = 99.99; bill discount 10.00.
  const lines = [
    calculateLine({
      quantity: '10',
      unitPrice: '100',
      taxRate: '5',
      discount: { type: 'PERCENT', value: '5' },
    }),
    calculateLine({ quantity: '3', unitPrice: '33.33', taxRate: '5' }),
  ];
  const priced = calculateDocument(lines, { type: 'AMOUNT', value: '10' });
  const shares = shareFils(
    toFils(priced.totals.discountAmount),
    lines.map((line) => line.lineTotalFils),
  );
  return {
    priced,
    lines: priced.lines.map((line, index): ValuedLine => ({
      quantityOrdered: line.quantity,
      unitCost: line.unitPrice,
      taxRate: line.taxRate,
      taxAmount: line.taxAmount,
      netAmount: ((lines[index].lineTotalFils - shares[index]) / 100).toFixed(2),
    })),
  };
}

describe('a discounted line', () => {
  test('the bill discount is shared to the fil and VAT is after both discounts', () => {
    const { priced, lines } = priceDiscounted();
    const net = lines.reduce((sum, line) => sum + toFils(line.netAmount!.toString()), 0);
    assert.equal(net, toFils(priced.totals.subtotal), 'lines add up to the taxable amount');
    assert.equal(priced.totals.subtotal, '1039.99', '950.00 + 99.99 − 10.00');
    const vat = lines.reduce((sum, line) => sum + toFils(line.taxAmount!.toString()), 0);
    assert.equal(vat, toFils(priced.totals.taxAmount));
  });

  test('4 then 6 of 10: the deliveries add up to the line exactly', () => {
    const { lines } = priceDiscounted();
    const line = lines[0];
    const first = movementValue({
      line,
      movementMilli: 4000,
      receivedBeforeMilli: 0,
      unitCost: '100.00',
      taxRate: '5.00',
    });
    const second = movementValue({
      line,
      movementMilli: 6000,
      receivedBeforeMilli: 4000,
      unitCost: '100.00',
      taxRate: '5.00',
    });
    assert.equal(first.netFils + second.netFils, toFils(line.netAmount!.toString()));
    assert.equal(first.taxFils + second.taxFils, toFils(line.taxAmount!.toString()));
    assert.deepEqual(receivedLineValue({ ...line, quantityReceived: '10' }, '5'), {
      netFils: toFils(line.netAmount!.toString()),
      taxFils: toFils(line.taxAmount!.toString()),
    });
  });

  test('awkward splits never drift: 1 + 1 + 1 of 3 at 33.33 less a share of the bill', () => {
    const { lines } = priceDiscounted();
    const line = lines[1];
    let net = 0;
    let tax = 0;
    for (let before = 0; before < 3000; before += 1000) {
      const value = movementValue({
        line,
        movementMilli: 1000,
        receivedBeforeMilli: before,
        unitCost: '33.33',
        taxRate: '5.00',
      });
      net += value.netFils;
      tax += value.taxFils;
    }
    assert.equal(net, toFils(line.netAmount!.toString()));
    assert.equal(tax, toFils(line.taxAmount!.toString()));
  });

  test('a return takes off exactly what those units were booked at', () => {
    const { lines } = priceDiscounted();
    const line = lines[0];
    const inFirst = movementValue({
      line,
      movementMilli: 4000,
      receivedBeforeMilli: 0,
      unitCost: '100.00',
      taxRate: '5.00',
    });
    const back = movementValue({
      line,
      movementMilli: -4000,
      receivedBeforeMilli: 4000,
      unitCost: '100.00',
      taxRate: '5.00',
    });
    assert.deepEqual(back, { netFils: -inFirst.netFils, taxFils: -inFirst.taxFils });
  });

  test('the supplier balance is the received value after discounts', () => {
    const { lines } = priceDiscounted();
    const received = receivedValueFils(
      lines.map((line) => ({ ...line, quantityReceived: line.quantityOrdered })),
      '5',
    );
    const { priced } = priceDiscounted();
    assert.equal(received, toFils(priced.totals.totalAmount));
  });

  test('the spec example: 100 less 20, VAT 5% is 4.00, not 5.00', () => {
    const line = calculateLine({
      quantity: '1',
      unitPrice: '100',
      taxRate: '5',
      discount: { type: 'AMOUNT', value: '20' },
    });
    assert.equal(line.lineTotal, '80.00');
    assert.equal(line.taxAmount, '4.00');
  });

  test('cost per unit after discount, for the optional cost-price update', () => {
    const { lines } = priceDiscounted();
    assert.equal(unitCostAfterDiscount(plain), '33.33', 'no discount: the unit cost');
    // 950.00 less its share of the bill discount, over 10 units.
    // Half-up to the fil, in whole fils (no floating point): 940.95 / 10 = 94.095 → 94.10.
    const perUnit = filsToString(Math.round(toFils(lines[0].netAmount!.toString()) / 10));
    assert.equal(unitCostAfterDiscount(lines[0]), perUnit);
    // Half a litre ordered: the price of a whole one.
    assert.equal(
      unitCostAfterDiscount({ ...plain, quantityOrdered: '0.500', netAmount: '10.00' }),
      '20.00',
    );
  });
});

describe('ageing a supplier bill', () => {
  const day = 86_400_000;
  const now = Date.UTC(2026, 9, 2, 11, 30);
  const billDate = new Date(Date.UTC(2026, 7, 20));

  test('no due date: days since the bill, exactly as before', () => {
    const before = Math.max(0, Math.floor((now - billDate.getTime()) / day));
    assert.deepEqual(payableAge(billDate, null, now), {
      ageDays: before,
      dueDate: null,
      daysOverdue: null,
    });
  });

  test('due date ahead: current; the day after it: overdue (day 31)', () => {
    const ahead = payableAge(billDate, new Date(Date.UTC(2026, 9, 10)), now);
    assert.ok(ahead.ageDays <= 30);
    assert.equal(ahead.daysOverdue, 0);
    const dueToday = payableAge(billDate, new Date(Date.UTC(2026, 9, 2)), now);
    assert.equal(dueToday.ageDays, 30);
    assert.equal(dueToday.daysOverdue, 0);
    const late = payableAge(billDate, new Date(Date.UTC(2026, 8, 27)), now);
    assert.equal(late.daysOverdue, 5);
    assert.equal(late.ageDays, 35);
  });
});
