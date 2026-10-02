/**
 * Unit tests for when a vehicle arrived (lib/workshop/arrival.ts): a job
 * card opens now unless an earlier date is given, and never in the future.
 *
 *   npm run test:unit
 */
import './unit-env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { arrivalMoment } from '@/lib/workshop/arrival';
import { DomainError } from '@/lib/errors';

// 2 Oct 2026, 15:30 in Dubai.
const NOW = new Date('2026-10-02T11:30:00Z');

const rejects = (date: string, time: string, pattern: RegExp) =>
  assert.throws(
    () => arrivalMoment(date, time, NOW),
    (error: unknown) => error instanceof DomainError && pattern.test(error.message),
  );

describe('when the vehicle arrived', () => {
  test('nothing given, or today without a time: the job opens now', () => {
    assert.equal(arrivalMoment(undefined, undefined, NOW), null);
    assert.equal(arrivalMoment('', '', NOW), null);
    assert.equal(arrivalMoment('2026-10-02', '', NOW), null);
  });

  test('an earlier day: that day, at midday Dubai time unless a time is given', () => {
    assert.equal(arrivalMoment('2026-09-24', '', NOW)?.toISOString(), '2026-09-24T08:00:00.000Z');
    assert.equal(
      arrivalMoment('2026-09-24', '08:15', NOW)?.toISOString(),
      '2026-09-24T04:15:00.000Z',
    );
  });

  test('earlier today, at a time already passed', () => {
    assert.equal(
      arrivalMoment('2026-10-02', '09:00', NOW)?.toISOString(),
      '2026-10-02T05:00:00.000Z',
    );
  });

  test('never in the future, never a nonsense date', () => {
    rejects('2026-10-03', '', /future/);
    rejects('2026-10-02', '18:00', /later than now/);
    rejects('1999-12-31', '', /too far back/);
    rejects('2026-13-40', '', /Enter the date/);
    rejects('yesterday', '', /Enter the date/);
    rejects('', '09:00', /Choose the date/);
    rejects('2026-09-24', '25:00', /HH:MM/);
  });
});
