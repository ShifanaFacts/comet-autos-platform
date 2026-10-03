/**
 * Unit tests for an invoice's round-off (lib/billing/document-lines.ts
 * withRounding): after VAT, either way, at most 5.00, never below zero.
 *
 *   npm run test:unit
 */
import './unit-env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { withRounding } from '@/lib/billing/document-lines';
import { calculateDocument, calculateLine } from '@/lib/money';
import { DomainError } from '@/lib/errors';

const totals = calculateDocument([
  calculateLine({ quantity: '1', unitPrice: '999.52', taxRate: '5' }),
]).totals;

describe('an invoice round-off', () => {
  test('none: the total is subtotal + VAT, as before', () => {
    assert.equal(totals.totalAmount, '1049.50');
    assert.deepEqual(withRounding(totals, ''), {
      roundingAdjustment: '0.00',
      totalAmount: '1049.50',
    });
    assert.deepEqual(withRounding(totals, undefined), {
      roundingAdjustment: '0.00',
      totalAmount: '1049.50',
    });
  });

  test('down or up, outside VAT', () => {
    assert.deepEqual(withRounding(totals, '-0.50'), {
      roundingAdjustment: '-0.50',
      totalAmount: '1049.00',
    });
    assert.deepEqual(withRounding(totals, '0.50'), {
      roundingAdjustment: '0.50',
      totalAmount: '1050.00',
    });
  });

  test('at most 5.00 either way, and never below zero', () => {
    assert.throws(() => withRounding(totals, '-5.01'), DomainError);
    assert.throws(() => withRounding(totals, '5.01'), DomainError);
    const small = calculateDocument([
      calculateLine({ quantity: '1', unitPrice: '1', taxRate: '0' }),
    ]).totals;
    assert.throws(() => withRounding(small, '-1.50'), DomainError);
  });
});
