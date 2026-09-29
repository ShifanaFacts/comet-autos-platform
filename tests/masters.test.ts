/**
 * Integration tests for the accounting masters:
 *
 *  - tax codes: every workshop starts with SR, ZR, EX and OS, SR the default;
 *    SR's rate and the standard rate in Settings move together; a code's
 *    rate must match its treatment; a line priced by a code keeps the code,
 *    its rate and its treatment, and a later change to the code never moves
 *    an issued invoice; expenses take their VAT from a purchase code;
 *  - payment modes: every workshop starts with Cash, Card, Bank transfer,
 *    Cheque and Online, each on its ledger account; a mode must post to a
 *    money account; the default can't be retired.
 *
 * Every record is made in a throwaway test organization. Needs the
 * 20260930090000_tax_codes_payment_modes migration applied.
 *
 *   npm run test:integration
 */
import 'dotenv/config';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AccountRole } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { ensureChart } from '@/lib/accounting/chart';
import {
  createTaxCode,
  getTaxCodeOptions,
  listTaxCodes,
  updateTaxCode,
} from '@/lib/accounting/tax-codes';
import {
  createPaymentMode,
  getPaymentModeOptions,
  listPaymentModes,
  updatePaymentMode,
} from '@/lib/accounting/payment-modes';
import { createDirectInvoice } from '@/lib/billing/direct-invoice';
import { recordExpense } from '@/lib/finance/expenses';
import { updateOrganizationSettings } from '@/lib/organization/settings';
import { localDateString } from '@/lib/format';
import { createTestOrg, expectDomainError, RUN, type TestOrg } from './support';

let a: TestOrg;
let roles: Record<AccountRole, string>;

before(async () => {
  a = await createTestOrg('Masters');
  roles = await prisma.$transaction((tx) => ensureChart(tx, a.organizationId));
});

after(async () => {
  await prisma.$disconnect();
});

const code = async (short: string) => {
  const codes = await getTaxCodeOptions(a.organizationId, 'sales');
  const found = codes.find((c) => c.code === short);
  assert.ok(found, `code ${short} exists`);
  return found;
};

describe('tax codes', () => {
  test('every workshop starts with the four UAE codes, SR the default at its rate', async () => {
    const codes = await listTaxCodes(a.owner);
    assert.deepEqual(codes.map((c) => c.code).sort(), ['EX', 'OS', 'SR', 'ZR']);
    const sr = codes.find((c) => c.code === 'SR')!;
    assert.equal(sr.rate, '5.00');
    assert.equal(sr.isDefault, true);
    assert.ok(codes.filter((c) => c.code !== 'SR').every((c) => c.rate === '0.00'));
  });

  test('SR and the standard rate in Settings move together', async () => {
    const sr = await code('SR');
    await updateTaxCode(a.owner, sr.id, {
      code: 'SR',
      name: 'Standard rated',
      rate: '7.5',
      treatment: 'STANDARD',
      forSales: 'true',
      forPurchases: 'true',
      isActive: 'true',
    });
    let org = await prisma.organization.findUniqueOrThrow({ where: { id: a.organizationId } });
    assert.equal(org.vatRate.toFixed(2), '7.50');

    await updateOrganizationSettings(a.owner, {
      name: org.name,
      isVatRegistered: 'true',
      vatRate: '5',
    });
    org = await prisma.organization.findUniqueOrThrow({ where: { id: a.organizationId } });
    assert.equal(org.vatRate.toFixed(2), '5.00');
    assert.equal((await code('SR')).rate, '5.00');
  });

  test('a rate must fit its treatment; codes are unique; a standard code keeps its treatment', async () => {
    await expectDomainError(
      createTaxCode(a.owner, {
        code: 'ZX',
        name: 'Zero with a rate',
        rate: '5',
        treatment: 'ZERO_RATED',
        forSales: 'on',
      }),
      /always 0%/,
    );
    await expectDomainError(
      createTaxCode(a.owner, {
        code: 'sr',
        name: 'Again',
        rate: '5',
        treatment: 'STANDARD',
        forSales: 'on',
      }),
      /already used/,
    );
    const zr = await code('ZR');
    await expectDomainError(
      updateTaxCode(a.owner, zr.id, {
        code: 'ZR',
        name: 'Zero rated',
        rate: '5',
        treatment: 'STANDARD',
        forSales: 'on',
      }),
      /keeps its VAT treatment/,
    );
  });

  test('a line keeps its code, and a later change to the code never moves the invoice', async () => {
    const customer = await prisma.customer.create({
      data: { organizationId: a.organizationId, name: `Masters ${RUN}`, phone: '050 111 2233' },
    });
    const extra = await createTaxCode(a.owner, {
      code: `T${RUN.slice(-3)}`,
      name: 'Test 10%',
      rate: '10',
      treatment: 'STANDARD',
      forSales: 'on',
    });
    const zr = await code('ZR');
    const { invoiceId } = await createDirectInvoice(a.owner, {
      customerId: customer.id,
      items: [
        {
          itemType: 'PART',
          description: 'Export part',
          quantity: '1',
          unitPrice: '100',
          taxCodeId: zr.id,
        },
        {
          itemType: 'LABOUR',
          description: 'Fitting',
          quantity: '1',
          unitPrice: '200',
          taxCodeId: extra.id,
        },
      ],
    });
    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { items: { orderBy: { lineTotal: 'asc' } } },
    });
    assert.equal(invoice.taxAmount.toFixed(2), '20.00');
    assert.equal(invoice.items[0].vatTreatment, 'ZERO_RATED');
    assert.equal(invoice.items[0].taxCodeId, zr.id);
    assert.equal(invoice.items[1].taxRate?.toFixed(2), '10.00');
    assert.equal(invoice.items[1].taxCodeId, extra.id);

    await updateTaxCode(a.owner, extra.id, {
      code: extra.code,
      name: 'Test now 12%',
      rate: '12',
      treatment: 'STANDARD',
      forSales: 'on',
      isActive: 'true',
    });
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    assert.equal(after.taxAmount.toFixed(2), '20.00', 'issued figures never move');
  });

  test('an expense takes its VAT from its purchase code; exempt reclaims nothing', async () => {
    const codes = await getTaxCodeOptions(a.organizationId, 'purchases');
    const sr = codes.find((c) => c.code === 'SR')!;
    const ex = codes.find((c) => c.code === 'EX')!;
    const taxed = await recordExpense(a.owner, {
      description: 'Workshop supplies',
      amount: '200',
      taxCodeId: sr.id,
      expenseDate: localDateString(),
      paymentMethod: 'CASH',
    });
    assert.equal(taxed.taxAmount?.toFixed(2), '10.00');
    assert.equal(taxed.taxCodeId, sr.id);
    const exempt = await recordExpense(a.owner, {
      description: 'Residential rent for staff',
      amount: '3000',
      taxCodeId: ex.id,
      expenseDate: localDateString(),
    });
    assert.equal(exempt.taxAmount, null);
    assert.equal(exempt.taxCodeId, ex.id);
  });

  test('the default code can’t be retired', async () => {
    const sr = await code('SR');
    await expectDomainError(
      updateTaxCode(a.owner, sr.id, {
        code: 'SR',
        name: 'Standard rated',
        rate: '5',
        treatment: 'STANDARD',
        forSales: 'true',
        forPurchases: 'true',
        isActive: 'false',
      }),
      /default code can’t be retired/,
    );
  });
});

describe('payment modes', () => {
  test('every workshop starts with five, each on its ledger account', async () => {
    const receipts = await getPaymentModeOptions(a.organizationId, 'receipts');
    const byName = new Map(receipts.map((mode) => [mode.name, mode]));
    assert.equal(byName.get('Cash')?.accountId, roles.CASH);
    assert.equal(byName.get('Cash')?.isDefault, true);
    assert.equal(byName.get('Card')?.accountId, roles.CARD_CLEARING);
    assert.equal(byName.get('Card')?.requiresReference, true);
    assert.equal(byName.get('Bank transfer')?.accountId, roles.BANK);
    assert.equal(receipts[0].name, 'Cash', 'the default comes first');
  });

  test('a mode posts only to a money account, under a name of its own', async () => {
    await expectDomainError(
      createPaymentMode(a.owner, {
        name: 'Into sales',
        method: 'CASH',
        accountId: roles.SALES_OTHER,
        forReceipts: 'true',
      }),
      /cash, bank or card account/,
    );
    await expectDomainError(
      createPaymentMode(a.owner, {
        name: 'cash',
        method: 'CASH',
        accountId: roles.CASH,
        forReceipts: 'true',
      }),
      /already a payment mode/,
    );
    const mode = await createPaymentMode(a.owner, {
      name: 'Card — terminal 2',
      method: 'CARD',
      accountId: roles.CARD_CLEARING,
      forReceipts: 'true',
      requiresReference: 'true',
    });
    const payments = await getPaymentModeOptions(a.organizationId, 'payments');
    assert.ok(!payments.some((m) => m.id === mode.id), 'offered for receipts only');
  });

  test('the default can’t be retired; another can', async () => {
    const { modes } = await listPaymentModes(a.owner);
    const cash = modes.find((m) => m.name === 'Cash')!;
    await expectDomainError(
      updatePaymentMode(a.owner, cash.id, {
        name: 'Cash',
        method: 'CASH',
        accountId: cash.accountId,
        forReceipts: 'true',
        forPayments: 'true',
        isActive: 'false',
      }),
      /default mode can’t be retired/,
    );
    const online = modes.find((m) => m.name === 'Online')!;
    await updatePaymentMode(a.owner, online.id, {
      name: 'Online',
      method: 'ONLINE',
      accountId: online.accountId,
      forReceipts: 'true',
      forPayments: 'true',
      isActive: 'false',
    });
    const receipts = await getPaymentModeOptions(a.organizationId, 'receipts');
    assert.ok(!receipts.some((m) => m.name === 'Online'), 'a retired mode is not offered');
  });
});
