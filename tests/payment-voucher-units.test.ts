/**
 * Unit tests for payment vouchers' arithmetic — no database:
 *
 *  - the bank's card fee is its rate on the amount collected, and the VAT
 *    the VAT rate on the fee, both rounded like an invoice line; what is
 *    handed over is the rest, to the fil;
 *  - a figure typed from the bank statement stands;
 *  - a fee can't be VAT alone, VAT can't exceed its fee, and the fee can't
 *    swallow the whole amount;
 *  - the amount in words, as a voucher or cheque writes it.
 *
 *   npm run test:unit
 */
import './unit-env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { splitCardFee } from '@/lib/finance/card-fee';
import { aedInWords } from '@/lib/documents/amount-words';
import { DomainError } from '@/lib/errors';

describe('the bank’s fee on card money collected for someone', () => {
  test('1,000 at 2% plus 5% VAT: 20 + 1, so 979 is handed over', () => {
    const split = splitCardFee('1000.00', { feeRate: '2' }, '5.00');
    assert.deepEqual(split, { rate: '2', fee: 2000, vat: 100, paid: 97900 });
  });

  test('rounded to the fil like a VAT line', () => {
    // 2.5% of 333.33 = 8.333… → 8.33; 5% of 8.33 = 0.4165 → 0.42.
    const split = splitCardFee('333.33', { feeRate: '2.5' }, '5.00');
    assert.equal(split.fee, 833);
    assert.equal(split.vat, 42);
    assert.equal(split.paid, 33333 - 833 - 42);
  });

  test('the bank statement’s own figures stand', () => {
    const split = splitCardFee(
      '1000.00',
      { feeRate: '2', feeAmount: '19.50', feeVatAmount: '0.98' },
      '5.00',
    );
    assert.deepEqual([split.fee, split.vat, split.paid], [1950, 98, 100000 - 1950 - 98]);
  });

  test('no rate and no fee: everything is handed over', () => {
    assert.deepEqual(splitCardFee('500.00', {}, '5.00'), { rate: null, fee: 0, vat: 0, paid: 50000 });
  });

  test('impossible figures are refused', () => {
    assert.throws(() => splitCardFee('100.00', { feeAmount: '', feeVatAmount: '1.00' }, '5.00'), DomainError);
    assert.throws(() => splitCardFee('100.00', { feeAmount: '1.00', feeVatAmount: '2.00' }, '5.00'), DomainError);
    assert.throws(() => splitCardFee('100.00', { feeAmount: '100.00', feeVatAmount: '0' }, '5.00'), DomainError);
  });
});

describe('the amount in words', () => {
  test('dirhams only', () => {
    assert.equal(aedInWords('979.00'), 'UAE Dirhams Nine Hundred Seventy-Nine Only');
  });
  test('with fils', () => {
    assert.equal(aedInWords('1250.50'), 'UAE Dirhams One Thousand Two Hundred Fifty and Fils Fifty Only');
  });
  test('large and round', () => {
    assert.equal(aedInWords('2000000.00'), 'UAE Dirhams Two Million Only');
    assert.equal(aedInWords('15.05'), 'UAE Dirhams Fifteen and Fils Five Only');
  });
});
