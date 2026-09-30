/**
 * Unit tests for reading a supplier bill from its text (src/lib/bill-reader).
 *
 * The samples written out below are the layouts the workshop's bills use —
 * a fuel station's tax invoice, a parts trader's invoice with item rows, a
 * handwritten-style cash bill, a card-machine slip. The real bills live in
 * tests/fixtures/bills/ as `<name>.ocr.txt` with their expected values in
 * `expected.json`; every one found there is parsed and compared.
 *
 *   npm run test:unit
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  chooseAmounts,
  findBillDate,
  findBillNumber,
  findSupplierTrn,
  normalise,
  parseBill,
  redactCards,
  type ParsedBill,
} from '@/lib/bill-reader/parse';
import { arabicWordsOnly } from '@/lib/bill-reader/ocr';

const OWN_TRN = '100234567800003';

const FUEL = `
ENOC RETAIL LLC
Site 1042 - Al Quoz
TRN : 100 0582 9430 0003
TAX INVOICE فاتورة ضريبية
Invoice No : 1042-558812        Date : 14/09/2026 10:42
Customer TRN: 100234567800003
SPECIAL 95      42.150 L   2.58    108.75
Gross Amt                         103.57
VAT Amt [5%]                        5.18
Net Amount Dhs                    108.75
Paid by CARD  **** **** **** 4417
`;

const PARTS = `
TAIMOOR AUTO SPARE PARTS TR. LLC
Deira, Dubai  Tel: 04 222 3344
TRN 100-3344-5566-7003
Tax Invoice
Doc. No: TI/26/004512     Dated 03-Sep-2026
Bill To: MOHAMMED MOWLA AUTO GARAGE LLC   TRN 100234567800003
1 BRAKE PAD SET FRONT     2 SET   145.00   290.00
2 OIL FILTER TOYOTA       4       18.50     74.00
3 ENGINE OIL 5W30 4L      3 PCS   96.00    288.00
Taxable Amount                             652.00
VAT 5%                                      32.60
Total Amount                               684.60
`;

const SLIP = `
NETWORK INTERNATIONAL
AL FUTTAIM MOTORS
TERMINAL ID 40128877   MERCHANT ID 200045581
SALE
VISA 4567XXXXXXXX1234
APPROVAL CODE 883201
AMOUNT : AED 315.00
`;

describe('cleaning the text', () => {
  test('card numbers are never kept', () => {
    assert.ok(!redactCards('VISA 4567XXXXXXXX1234').includes('1234'));
    assert.ok(!redactCards('Card **** **** **** 4417').includes('4417'));
    assert.ok(!redactCards('4111 1111 1111 1111').includes('1111'));
    assert.ok(!normalise(SLIP).join(' ').includes('1234'));
    assert.ok(!JSON.stringify(parseBill(FUEL)).includes('4417'));
  });

  test('a mask that OCR garbled still takes its digits with it', () => {
    assert.ok(!redactCards('Paid by CARD F**k kx xxkx 44717').includes('44717'));
    assert.ok(!redactCards('Paid by CARD *¥¥* xxx xxxx 4417').includes('4417'));
    // An amount on a card line, with its decimal point, stays.
    assert.match(redactCards('CARD AMOUNT AED 1315.00'), /1315[.]00/);
  });

  test('a TRN is not mistaken for a card number', () => {
    assert.match(redactCards('TRN 100 0582 9430 0003'), /100 0582 9430 0003/);
  });

  test('Arabic digits read as numbers', () => {
    assert.deepEqual(normalise('الإجمالي ١٠٥٫٠٠ / ١٠٥.٠٠'), ['الإجمالي 105٫00 / 105.00']);
  });
});

describe('the Arabic pass', () => {
  test('keeps Arabic wording and no digits at all', () => {
    const words = arabicWordsOnly(
      ['TRN : 100 0582 9430 3', 'فاتورة ضريبية 1042-2', 'Total 108.75'].join('\n'),
    );
    assert.match(words, /فاتورة ضريبية/);
    assert.ok(!/[0-9]/.test(words));
    assert.ok(!words.includes('TRN'));
  });

  test('Arabic "tax invoice" with a supplier TRN is a tax invoice', () => {
    const bill = parseBill(
      ['TRN : 100 0582 9430 0003', 'Total 108.75', arabicWordsOnly('فاتورة ضريبية 7')].join('\n'),
    );
    assert.equal(bill.isTaxInvoice, true);
    assert.equal(bill.total, '108.75');
  });
});

describe('the supplier TRN', () => {
  test('fifteen digits, spaces and dashes allowed', () => {
    assert.equal(findSupplierTrn(['TRN : 100 0582 9430 0003']), '100058294300003');
    assert.equal(findSupplierTrn(['TRN 100-3344-5566-7003']), '100334455667003');
  });

  test('our own TRN is never taken as the supplier’s', () => {
    assert.equal(findSupplierTrn(['Customer TRN: 100234567800003'], OWN_TRN), null);
    assert.equal(findSupplierTrn(['Customer TRN: 1002 3456 7800 003'], OWN_TRN), null);
    assert.equal(parseBill(FUEL, { ownTrn: OWN_TRN }).supplierTrn, '100058294300003');
    assert.equal(parseBill(PARTS, { ownTrn: OWN_TRN }).supplierTrn, '100334455667003');
    // A bill that only carries our TRN has no supplier TRN at all.
    const onlyOurs = parseBill('CASH BILL\nTo: Garage TRN 100234567800003\nTotal 50.00', {
      ownTrn: OWN_TRN,
    });
    assert.equal(onlyOurs.supplierTrn, null);
    assert.equal(onlyOurs.isTaxInvoice, false);
  });

  test('an unlabelled run of digits that isn’t a TRN is ignored', () => {
    assert.equal(findSupplierTrn(['Account 971500001112223']), null);
  });
});

describe('the bill number and date', () => {
  test('after each of the usual labels', () => {
    assert.equal(findBillNumber(['Invoice No : 1042-558812']), '1042-558812');
    assert.equal(findBillNumber(['Tax Invoice No. INV-7781']), 'INV-7781');
    assert.equal(findBillNumber(['Doc. No: TI/26/004512']), 'TI/26/004512');
    assert.equal(findBillNumber(['Bill No 4471']), '4471');
    assert.equal(findBillNumber(['Receipt No: R-99']), 'R-99');
    assert.equal(findBillNumber(['Invoice No: Date']), null);
  });

  test('day-first dates', () => {
    assert.equal(findBillDate(['Date : 14/09/2026 10:42']), '2026-09-14');
    assert.equal(findBillDate(['Dated 03-09-2026']), '2026-09-03');
    assert.equal(findBillDate(['03 Sep 2026']), '2026-09-03');
    assert.equal(findBillDate(['Dated 03-Sep-2026']), '2026-09-03');
    assert.equal(findBillDate(['Date 5.9.26']), '2026-09-05');
    assert.equal(findBillDate(['Date 31/02/2026']), null, 'not a real date');
    assert.equal(findBillDate(['Due date 30/09/2026', 'Date 14/09/2026']), '2026-09-14');
  });
});

describe('the amounts', () => {
  test('the three are chosen so that subtotal + VAT = total', () => {
    assert.deepEqual(chooseAmounts(normalise(PARTS)), {
      subtotal: '652.00',
      vat: '32.60',
      total: '684.60',
      warnings: [],
    });
  });

  test('"Net Amount" is the total when the arithmetic says so', () => {
    const fuel = chooseAmounts(normalise(FUEL));
    assert.equal(fuel.subtotal, '103.57');
    assert.equal(fuel.vat, '5.18');
    assert.equal(fuel.total, '108.75');
  });

  test('"Net Amount" is the subtotal when the arithmetic says so', () => {
    const bill = chooseAmounts(['Net Amount 200.00', 'VAT 5% 10.00', 'Grand Total 210.00']);
    assert.deepEqual([bill.subtotal, bill.vat, bill.total], ['200.00', '10.00', '210.00']);
  });

  test('a missing one is computed from the other two', () => {
    const noTotal = chooseAmounts(['Sub Total 100.00', 'VAT Amount 5.00']);
    assert.equal(noTotal.total, '105.00');
    const noVat = chooseAmounts(['Sub Total 100.00', 'Grand Total 105.00']);
    assert.equal(noVat.vat, '5.00');
    const noSubtotal = chooseAmounts(['VAT Amount 5.00', 'Total Amount 105.00']);
    assert.equal(noSubtotal.subtotal, '100.00');
  });

  test('a lost decimal is restored only when it makes the sum right', () => {
    const fixed = chooseAmounts(['Sub Total 162.00', 'VAT Amt [5%] 810', 'Total Amount 170.10']);
    assert.deepEqual([fixed.subtotal, fixed.vat, fixed.total], ['162.00', '8.10', '170.10']);
    assert.deepEqual(fixed.warnings, []);
    // 810 that fits as it stands is left alone.
    const real = chooseAmounts(['Sub Total 16200.00', 'VAT Amount 810', 'Total Amount 17010.00']);
    assert.equal(real.vat, '810.00');
  });

  test('figures that don’t add up are shown with the reason, not trusted silently', () => {
    const bad = chooseAmounts(['Sub Total 100.00', 'VAT Amount 5.00', 'Total Amount 150.00']);
    assert.equal(bad.warnings.length, 3);
    assert.match(bad.warnings[0].message, /isn’t the total/);
  });

  test('a total alone is kept; a subtotal alone is not guessed into a total', () => {
    assert.deepEqual(chooseAmounts(['AMOUNT : AED 315.00']).total, '315.00');
    const alone = chooseAmounts(['Sub Total 100.00']);
    assert.deepEqual([alone.subtotal, alone.vat, alone.total], [null, null, null]);
  });

  test('a percentage is not an amount', () => {
    const bill = chooseAmounts(['Taxable Amount 652.00', 'VAT 5% 32.60', 'Total Amount 684.60']);
    assert.equal(bill.vat, '32.60');
  });
});

describe('the whole bill', () => {
  test('a fuel station tax invoice', () => {
    const bill = parseBill(FUEL, { ownTrn: OWN_TRN });
    assert.equal(bill.supplierName, 'ENOC RETAIL LLC');
    assert.equal(bill.billNumber, '1042-558812');
    assert.equal(bill.billDate, '2026-09-14');
    assert.equal(bill.isTaxInvoice, true);
    assert.equal(bill.isCardSlip, false);
  });

  test('a parts invoice with item rows that add up', () => {
    const bill = parseBill(PARTS, { ownTrn: OWN_TRN });
    assert.equal(bill.supplierName, 'TAIMOOR AUTO SPARE PARTS TR. LLC');
    assert.equal(bill.billNumber, 'TI/26/004512');
    assert.equal(bill.billDate, '2026-09-03');
    assert.equal(bill.isTaxInvoice, true);
    assert.deepEqual(
      bill.lines.map((line) => [line.description, line.quantity, line.unitPrice, line.amount]),
      [
        ['BRAKE PAD SET FRONT', '2', '145.00', '290.00'],
        ['OIL FILTER TOYOTA', '4', '18.50', '74.00'],
        ['ENGINE OIL 5W30 4L', '3', '96.00', '288.00'],
      ],
    );
  });

  test('item rows that don’t sum to the subtotal are left out', () => {
    const bill = parseBill(PARTS.replace('288.00', '298.00').replace('96.00', '99.33'));
    assert.deepEqual(bill.lines, []);
    assert.equal(bill.subtotal, '652.00', 'the header amounts still stand');
  });

  test('a card-machine slip is a receipt, not a tax invoice', () => {
    const bill = parseBill(SLIP, { ownTrn: OWN_TRN });
    assert.equal(bill.isCardSlip, true);
    assert.equal(bill.isTaxInvoice, false);
    assert.equal(bill.supplierTrn, null);
    assert.equal(bill.total, '315.00');
    assert.equal(bill.vat, null, 'no VAT is claimed from a slip');
    assert.ok(!JSON.stringify(bill).includes('1234'));
  });

  test('"Tax Invoice" without a supplier TRN is not a tax invoice', () => {
    assert.equal(parseBill('TAX INVOICE\nTotal 50.00').isTaxInvoice, false);
  });

  test('text with nothing in it fills nothing', () => {
    const bill = parseBill('~~ ||| .,. \n ____');
    const filled = (Object.keys(bill) as (keyof ParsedBill)[]).filter((key) => {
      const value = bill[key];
      return Array.isArray(value) ? value.length > 0 && key !== 'headerLines' : Boolean(value);
    });
    assert.deepEqual(filled, []);
  });
});

// ─── The real bills ─────────────────────────────────────────────────────────

const FIXTURES = path.join(process.cwd(), 'tests', 'fixtures', 'bills');
const FIELDS = [
  'supplierTrn',
  'billNumber',
  'billDate',
  'subtotal',
  'vat',
  'total',
  'isTaxInvoice',
] as const;
type Expected = Partial<Record<(typeof FIELDS)[number], string | boolean | null>> & {
  /** Fields that must match exactly; the rest may be empty but never wrong. */
  mustMatch?: string[];
  ownTrn?: string;
};

function loadFixtures(): { name: string; text: string; expected: Expected }[] {
  if (!fs.existsSync(FIXTURES)) return [];
  const all = fs.existsSync(path.join(FIXTURES, 'expected.json'))
    ? (JSON.parse(fs.readFileSync(path.join(FIXTURES, 'expected.json'), 'utf8')) as Record<
        string,
        Expected
      >)
    : {};
  return fs
    .readdirSync(FIXTURES)
    .filter((file) => file.endsWith('.ocr.txt'))
    .map((file) => {
      const name = file.replace(/\.ocr\.txt$/, '');
      const own = path.join(FIXTURES, `${name}.expected.json`);
      const expected = fs.existsSync(own)
        ? (JSON.parse(fs.readFileSync(own, 'utf8')) as Expected)
        : (all[name] ?? all[file] ?? null);
      return { name, text: fs.readFileSync(path.join(FIXTURES, file), 'utf8'), expected };
    })
    .filter((fixture): fixture is { name: string; text: string; expected: Expected } =>
      Boolean(fixture.expected),
    );
}

describe('the real bills in tests/fixtures/bills', () => {
  const fixtures = loadFixtures();
  if (fixtures.length === 0) {
    test(
      'no fixtures found',
      { skip: 'add <name>.ocr.txt files and expected.json to tests/fixtures/bills' },
      () => {},
    );
    return;
  }
  for (const fixture of fixtures) {
    test(`${fixture.name}: nothing is filled with a wrong value`, () => {
      const bill = parseBill(fixture.text, { ownTrn: fixture.expected.ownTrn ?? OWN_TRN });
      const mustMatch = fixture.expected.mustMatch ?? [];
      for (const field of FIELDS) {
        if (!(field in fixture.expected)) continue;
        const want = fixture.expected[field];
        const got = bill[field];
        if (mustMatch.includes(field)) {
          assert.equal(got, want, `${field} must match`);
        } else if (got !== null && got !== false) {
          // Empty is fine; a value, if given, must be the right one.
          assert.equal(got, want, `${field} was filled with a wrong value`);
        }
      }
    });
  }
});
