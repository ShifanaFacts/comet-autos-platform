/**
 * Integration tests for merging a duplicate customer into the one kept:
 * everything moves, what they owe moves with it, the issued invoice keeps the
 * name printed on it, missing contact details are filled but nothing is
 * overwritten, and the duplicate is archived.
 *
 * Every record is made in a throwaway test organization.
 *
 *   npm run test:integration
 */
import 'dotenv/config';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@/lib/prisma';
import { AuthError } from '@/lib/auth/authorize';
import { mergeCustomers, getMergePreview } from '@/lib/customers/merge';
import { createDirectInvoice } from '@/lib/billing/direct-invoice';
import { getCustomerStatement } from '@/lib/finance/statements';
import { createTestOrg, expectDomainError, RUN, type TestOrg } from './support';

let a: TestOrg;
let b: TestOrg;

before(async () => {
  a = await createTestOrg('MergeA');
  b = await createTestOrg('MergeB');
});

after(async () => {
  await prisma.$disconnect();
});

async function customer(org: TestOrg, name: string, extra: Record<string, string> = {}) {
  return prisma.customer.create({
    data: {
      organizationId: org.organizationId,
      name: `${name} ${RUN}`,
      phone: `050 ${Math.floor(Math.random() * 900 + 100)} ${Math.floor(Math.random() * 9000 + 1000)}`,
      ...extra,
    },
  });
}

describe('merging customers', () => {
  test('everything moves to the kept customer, and the duplicate is archived', async () => {
    const kept = await customer(a, 'Ahmed Kept');
    const duplicate = await customer(a, 'Ahmed Duplicate', {
      email: 'ahmed@example.com',
      taxNumber: '100200300400500',
    });
    const vehicle = await prisma.vehicle.create({
      data: {
        organizationId: a.organizationId,
        customerId: duplicate.id,
        plateNumber: `M${RUN.slice(-4)} 11`,
        make: 'Toyota',
        model: 'Corolla',
      },
    });
    const { invoiceId } = await createDirectInvoice(a.owner, {
      customerId: duplicate.id,
      items: [{ itemType: 'LABOUR', description: 'Service', quantity: '1', unitPrice: '300' }],
    });

    const preview = await getMergePreview(a.owner, duplicate.id);
    assert.equal(preview.vehicles, 1);
    assert.equal(preview.invoices, 1);

    const result = await mergeCustomers(a.owner, duplicate.id, {
      targetId: kept.id,
      reason: 'Entered twice',
    });
    assert.equal(result.moved.vehicles, 1);
    assert.equal(result.moved.invoices, 1);

    const movedVehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } });
    assert.equal(movedVehicle.customerId, kept.id);
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    assert.equal(invoice.customerId, kept.id);
    assert.equal(invoice.customerName, duplicate.name, 'the issued invoice keeps its printed name');

    const statement = await getCustomerStatement(a.owner, kept.id, {});
    assert.equal(
      statement.closing,
      '315.00',
      'what the duplicate owed is owed by the kept customer',
    );

    const after = await prisma.customer.findUniqueOrThrow({ where: { id: kept.id } });
    assert.equal(after.email, 'ahmed@example.com', 'a missing email is filled');
    assert.equal(after.taxNumber, '100200300400500');
    const archived = await prisma.customer.findUniqueOrThrow({ where: { id: duplicate.id } });
    assert.equal(archived.isActive, false);

    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: a.organizationId, action: 'customer.merged_in', entityId: kept.id },
    });
    assert.ok(audit, 'the merge is in the audit log');
  });

  test('nothing the kept customer has is overwritten', async () => {
    const kept = await customer(a, 'Sara Kept', { email: 'sara@kept.ae' });
    const duplicate = await customer(a, 'Sara Duplicate', { email: 'sara@old.ae' });
    await mergeCustomers(a.owner, duplicate.id, { targetId: kept.id });
    const after = await prisma.customer.findUniqueOrThrow({ where: { id: kept.id } });
    assert.equal(after.email, 'sara@kept.ae');
  });

  test('refused: into itself, into a deleted customer, across workshops, without the permission', async () => {
    const one = await customer(a, 'One');
    const gone = await customer(a, 'Gone');
    await prisma.customer.update({ where: { id: gone.id }, data: { isActive: false } });
    await expectDomainError(
      mergeCustomers(a.owner, one.id, { targetId: one.id }),
      /different customer/,
    );
    await expectDomainError(mergeCustomers(a.owner, one.id, { targetId: gone.id }), /is deleted/);

    const elsewhere = await customer(b, 'Elsewhere');
    await expectDomainError(
      mergeCustomers(a.owner, one.id, { targetId: elsewhere.id }),
      /Choose a customer from the list/,
    );
    await assert.rejects(mergeCustomers(a.viewer, one.id, { targetId: gone.id }), AuthError);
  });
});
