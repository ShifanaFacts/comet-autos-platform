/**
 * Unit tests for the accounting arithmetic that needs no database:
 *
 *  - a document's subtotal split by VAT treatment adds up exactly, a bill
 *    discount spread in proportion, and the rate-only split still reads as
 *    it always did;
 *  - a bill discount is shared across lines to the fil;
 *  - straight-line depreciation charges add up to exactly what is to be
 *    depreciated, starting the month after, and an asset brought in part-way
 *    through its life is depreciated over what is left of it.
 *
 *   npm run test:unit
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { splitByTreatment, splitSupplies } from '@/lib/finance/vat-split';
import { shareFils } from '@/lib/money';
import { depreciationPlan } from '@/lib/accounting/depreciation';
import { EMIRATE_BOX, rateFor, treatmentFromRate } from '@/lib/vat-treatment';

describe('VAT treatments', () => {
  test('a subtotal split by treatment always adds up to it', () => {
    const lines = [
      { lineTotal: '300.00', vatTreatment: 'STANDARD' as const },
      { lineTotal: '100.00', vatTreatment: 'ZERO_RATED' as const },
      { lineTotal: '50.00', vatTreatment: 'EXEMPT' as const },
      { lineTotal: '33.33', vatTreatment: 'OUT_OF_SCOPE' as const },
    ];
    for (const subtotal of [48333, 47000, 1, 12345, 0]) {
      const split = splitByTreatment(subtotal, lines);
      const sum = split.STANDARD + split.ZERO_RATED + split.EXEMPT + split.OUT_OF_SCOPE;
      assert.equal(sum, subtotal, `${subtotal} fils split exactly`);
    }
    // No bill discount: each treatment gets its own lines.
    assert.deepEqual(splitByTreatment(48333, lines), {
      STANDARD: 30000,
      ZERO_RATED: 10000,
      EXEMPT: 5000,
      OUT_OF_SCOPE: 3333,
    });
  });

  test('the rate-only split reads as before: 0% or no rate is zero-rated', () => {
    const lines = [
      { lineTotal: '600.00', taxRate: '5.00' },
      { lineTotal: '400.00', taxRate: '0' },
    ];
    assert.deepEqual(splitSupplies(100000, lines), { standard: 60000, zero: 40000 });
    assert.deepEqual(splitSupplies(90000, lines), { standard: 54000, zero: 36000 });
    assert.deepEqual(splitSupplies(50000, [{ lineTotal: '500.00', taxRate: null }]), {
      standard: 0,
      zero: 50000,
    });
  });

  test('the rate follows the treatment; each emirate has its Box 1 line', () => {
    assert.equal(rateFor('STANDARD', '5.00'), '5.00');
    assert.equal(rateFor('ZERO_RATED', '5.00'), '0.00');
    assert.equal(rateFor('EXEMPT', '5.00'), '0.00');
    assert.equal(treatmentFromRate('0.00'), 'ZERO_RATED');
    assert.equal(treatmentFromRate(null), 'ZERO_RATED');
    assert.equal(treatmentFromRate('5'), 'STANDARD');
    assert.equal(EMIRATE_BOX.DUBAI.box, '1b');
    assert.equal(Object.keys(EMIRATE_BOX).length, 7);
  });
});

describe('sharing a bill discount', () => {
  test('shares add up to the discount exactly', () => {
    const shares = shareFils(1000, [3333, 3333, 3334]);
    assert.equal(
      shares.reduce((a, b) => a + b, 0),
      1000,
    );
    assert.deepEqual(shareFils(0, [100, 200]), [0, 0]);
    assert.deepEqual(shareFils(7, [1, 1, 1]), [3, 2, 2]);
  });
});

describe('depreciation', () => {
  const asset = {
    acquiredOn: new Date('2026-01-15T00:00:00Z'),
    cost: '10000.00',
    residualValue: '1000.00',
    usefulLifeMonths: 7,
    funding: 'PAID',
    openingDepreciation: '0.00',
    openingThrough: null,
  };

  test('monthly charges add up to cost less residual, to the fil', () => {
    const plan = depreciationPlan(asset);
    assert.equal(plan.months, 7);
    assert.equal(plan.base, 900000);
    let total = 0;
    for (let n = 1; n <= plan.months; n += 1) total += plan.charge(n);
    assert.equal(total, 900000);
    // 9000 over 7 months: 1285.71 or 1285.72 a month.
    assert.ok([128571, 128572].includes(plan.charge(1)));
  });

  test('starts the month after it was bought', () => {
    const plan = depreciationPlan(asset);
    // February 2026.
    assert.equal(plan.startMonth, 2026 * 12 + 1);
  });

  test('an asset brought in part-way through its life is depreciated over what is left', () => {
    const plan = depreciationPlan({
      acquiredOn: new Date('2024-01-10T00:00:00Z'),
      cost: '12000.00',
      residualValue: '0.00',
      usefulLifeMonths: 60,
      funding: 'OPENING',
      openingDepreciation: '4800.00',
      openingThrough: new Date('2025-12-31T00:00:00Z'),
    });
    // 23 months used (February 2024 to December 2025), 37 to go, from January 2026.
    assert.equal(plan.months, 37);
    assert.equal(plan.startMonth, 2026 * 12);
    assert.equal(plan.base, 720000);
    let total = 0;
    for (let n = 1; n <= plan.months; n += 1) total += plan.charge(n);
    assert.equal(total, 720000);
  });
});
