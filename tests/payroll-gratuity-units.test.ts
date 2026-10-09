/**
 * End-of-service gratuity and the WPS salary file: the rules alone, no
 * database.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { gratuityDays, gratuityEarnedFils, serviceYears } from '@/lib/hr/gratuity';
import { buildSif, validUaeIban } from '@/lib/hr/wps-file';

describe('end-of-service gratuity', () => {
  test('21 days a year for the first five years, 30 after', () => {
    assert.equal(gratuityDays(1), 21);
    assert.equal(gratuityDays(5), 105);
    assert.equal(gratuityDays(7), 165);
    assert.equal(gratuityDays(0), 0);
  });

  test('service counts the first and last day', () => {
    assert.equal(serviceYears('2025-01-01', '2025-12-31'), 1);
    assert.equal(serviceYears('2026-10-01', '2026-09-30'), 0);
  });

  test('a full year on AED 3,000 basic earns 21 days: AED 2,100', () => {
    assert.equal(gratuityEarnedFils('2025-01-01', '2025-12-31', 3_000_00), 2_100_00);
  });

  test('part of a year in proportion — a month’s share set aside from the start', () => {
    // 30 days of 365, 21 days a year, basic ÷ 30 a day.
    assert.equal(
      gratuityEarnedFils('2026-09-01', '2026-09-30', 3_000_00),
      Math.round((3_000_00 * 21 * 30) / 365 / 30),
    );
  });

  test('never more than two years’ basic salary', () => {
    assert.equal(gratuityEarnedFils('1990-01-01', '2026-12-31', 1_000_00), 24_000_00);
  });
});

describe('WPS salary file', () => {
  test('a UAE IBAN, check digits and all', () => {
    assert.equal(validUaeIban('AE070331234567890123456'), true);
    assert.equal(validUaeIban('AE080331234567890123456'), false);
    assert.equal(validUaeIban('GB29NWBK60161331926819'), false);
  });

  const base = {
    establishmentId: '1234567890123',
    routingCode: '803320101',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    createdDay: '2026-10-02',
    createdTime: '0915',
    createdSeconds: '07',
  };

  test('an EDR line per person and the SCR total, named for the establishment', () => {
    const file = buildSif({
      ...base,
      employees: [
        {
          name: 'Ali',
          personCode: '10000000000001',
          agentCode: '803320101',
          iban: 'AE070331234567890123456',
          fixedFils: 3_500_00,
          variableFils: 0,
          leaveDays: 2,
        },
      ],
    });
    assert.deepEqual(file.problems, []);
    assert.equal(file.fileName, '1234567890123261002091507.SIF');
    assert.deepEqual(file.content.trimEnd().split('\r\n'), [
      'EDR,10000000000001,803320101,AE070331234567890123456,2026-09-01,2026-09-30,30,3500.00,0.00,2',
      'SCR,1234567890123,803320101,2026-10-02,0915,092026,1,3500.00,AED,SALARY 092026',
    ]);
  });

  test('says what is missing instead of making a file the bank would reject', () => {
    const file = buildSif({
      ...base,
      establishmentId: null,
      employees: [
        {
          name: 'Ravi',
          personCode: null,
          agentCode: '803320101',
          iban: null,
          fixedFils: 1_00,
          variableFils: 0,
          leaveDays: 0,
        },
      ],
    });
    assert.equal(file.problems.length, 2);
    assert.match(file.problems[1], /Ravi: MOHRE person code, IBAN/);
  });
});
