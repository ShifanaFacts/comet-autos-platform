/**
 * Unit tests for pricing a line by its tax code: the code decides both the
 * rate and the VAT treatment, a line without one is priced as before, and a
 * code that isn't in the list is refused against that line.
 *
 *   npm run test:unit
 */
import './unit-env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { priceDocument } from '@/lib/billing/document-lines';
import { DomainError } from '@/lib/errors';

const SR = '00000000-0000-7000-8000-000000000001';
const ZR = '00000000-0000-7000-8000-000000000002';
const HIGH = '00000000-0000-7000-8000-000000000003';
const codes = new Map([
  [SR, { rate: '5.00', treatment: 'STANDARD' as const }],
  [ZR, { rate: '0.00', treatment: 'ZERO_RATED' as const }],
  [HIGH, { rate: '10.00', treatment: 'STANDARD' as const }],
]);
const line = (extra: Record<string, string>) => ({
  itemType: 'PART' as const,
  description: 'Brake pads',
  quantity: '2',
  unitPrice: '100',
  ...extra,
});

describe('a line priced by its tax code', () => {
  test('the code decides the rate and the treatment, and is kept on the line', () => {
    const { lines, totals } = priceDocument(
      [line({ taxCodeId: HIGH }), line({ taxCodeId: ZR })],
      '5.00',
      {},
      codes,
    );
    assert.equal(lines[0].amounts.taxAmount, '20.00');
    assert.equal(lines[0].vatTreatment, 'STANDARD');
    assert.equal(lines[0].taxCodeId, HIGH);
    assert.equal(lines[1].amounts.taxAmount, '0.00');
    assert.equal(lines[1].vatTreatment, 'ZERO_RATED');
    assert.equal(totals.taxAmount, '20.00');
    assert.equal(totals.totalAmount, '420.00');
  });

  test('a code outweighs a treatment sent with it', () => {
    const { lines } = priceDocument(
      [line({ taxCodeId: ZR, vatTreatment: 'STANDARD' })],
      '5.00',
      {},
      codes,
    );
    assert.equal(lines[0].vatTreatment, 'ZERO_RATED');
    assert.equal(lines[0].amounts.taxAmount, '0.00');
  });

  test('without a code a line is priced by its treatment, as before', () => {
    const { lines } = priceDocument([line({ vatTreatment: 'STANDARD' })], '5.00', {});
    assert.equal(lines[0].amounts.taxAmount, '10.00');
    assert.equal(lines[0].taxCodeId, null);
  });

  test('a code that is not in use is refused against its line', () => {
    assert.throws(
      () =>
        priceDocument(
          [line({}), line({ taxCodeId: '00000000-0000-7000-8000-00000000dead' })],
          '5.00',
          {},
          codes,
        ),
      (error: unknown) =>
        error instanceof DomainError && error.field === 'items.1' && /tax code/.test(error.message),
    );
  });
});
