/**
 * The overviews' growth figures: which period each one is compared with, and
 * how the change is worked out. Pure rules — no database.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { comparisonOf, growth } from '@/lib/overview/compare';
import type { ResolvedPeriod } from '@/lib/finance/dashboard';

const period = (key: ResolvedPeriod['key'], from: string, to: string) =>
  ({
    key,
    from,
    to,
    label: '',
    periodEnd: to,
    start: new Date(),
    end: new Date(),
  }) as ResolvedPeriod;

describe('overview comparisons', () => {
  test('this month so far is compared with the same days last month', () => {
    const { input, label } = comparisonOf(period('month', '2026-10-01', '2026-10-05'));
    assert.deepEqual(input, { period: 'custom', from: '2026-09-01', to: '2026-09-05' });
    assert.equal(label, 'vs the same days last month');
  });

  test('a month end stays inside the shorter month', () => {
    const { input } = comparisonOf(period('month', '2026-03-01', '2026-03-31'));
    assert.deepEqual(input, { period: 'custom', from: '2026-02-01', to: '2026-02-28' });
  });

  test('this year against the same days last year; a custom range against the days before it', () => {
    assert.deepEqual(comparisonOf(period('year', '2026-01-01', '2026-10-05')).input, {
      period: 'custom',
      from: '2025-01-01',
      to: '2025-10-05',
    });
    const custom = comparisonOf(period('custom', '2026-10-01', '2026-10-10'));
    assert.deepEqual(custom.input, { period: 'custom', from: '2026-09-21', to: '2026-09-30' });
    assert.equal(custom.label, 'vs the 10 days before');
  });

  test('growth in percent to one decimal; nothing to compare when the earlier figure is zero', () => {
    assert.equal(growth(150, 100), 50);
    assert.equal(growth(75, 100), -25);
    assert.equal(growth(1, 3), -66.7);
    assert.equal(growth(100, 0), null);
    assert.equal(growth(-50, -100), 50, 'a smaller loss is a rise');
  });
});
