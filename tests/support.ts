/**
 * Shared setup for integration tests: throwaway organizations with staff,
 * permissions, and (optionally) a stocked parts catalog. Every run creates
 * fresh organizations, so the real Comet Autos data is never touched.
 */
import assert from 'node:assert/strict';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { DomainError } from '@/lib/errors';
import { PERMISSION_CODES } from '@/lib/auth/permission-catalog';

export const RUN = Date.now().toString(36).toUpperCase();

/** Every code the system enforces — a test owner holds the lot. */
export const ALL_PERMISSIONS = PERMISSION_CODES;

export interface TestOrg {
  organizationId: string;
  branchId: string;
  owner: AuthenticatedUser;
  viewer: AuthenticatedUser;
  technicianIds: string[];
  parts: Record<string, { id: string; sku: string }>;
}

export async function createTestOrg(
  label: string,
  parts: { sku: string; name: string; cost: string; price: string; stock: string }[] = [],
): Promise<TestOrg> {
  const org = await prisma.organization.create({
    data: { name: `Test ${label} ${RUN}`, phone: '04 000 0000', address: 'Test address' },
  });
  const branch = await prisma.branch.create({ data: { organizationId: org.id, code: 'T', name: 'Test branch' } });
  const makeUser = (email: string) =>
    prisma.user.create({
      data: { organizationId: org.id, primaryBranchId: branch.id, email, passwordHash: 'not-used', fullName: `${label} ${email.split('@')[0]}` },
    });
  const ownerUser = await makeUser('owner@test.local');
  const viewerUser = await makeUser('viewer@test.local');
  const technicians = await Promise.all(
    ['Tech One', 'Tech Two'].map((name, index) =>
      prisma.employee.create({
        data: {
          organizationId: org.id,
          branchId: branch.id,
          employeeCode: `T-${index}`,
          firstName: name.split(' ')[0],
          lastName: name.split(' ')[1],
          hireDate: new Date('2024-01-01T00:00:00Z'),
        },
      }),
    ),
  );

  const createdParts: TestOrg['parts'] = {};
  for (const part of parts) {
    const created = await prisma.part.create({
      data: {
        organizationId: org.id,
        sku: part.sku,
        name: part.name,
        unitOfMeasure: 'piece',
        defaultCostPrice: part.cost,
        defaultSellingPrice: part.price,
        defaultTaxRate: '5.00',
      },
    });
    if (Number(part.stock) > 0) {
      await prisma.inventoryTransaction.create({
        data: {
          organizationId: org.id,
          branchId: branch.id,
          partId: created.id,
          transactionType: 'ADJUSTMENT',
          quantity: part.stock,
          unitCost: part.cost,
          performedByUserId: ownerUser.id,
          note: 'Opening stock (test)',
        },
      });
    }
    createdParts[part.sku] = { id: created.id, sku: part.sku };
  }

  const base = { organizationId: org.id, primaryBranchId: branch.id, branchPermissions: new Map<string, Set<string>>() };
  return {
    organizationId: org.id,
    branchId: branch.id,
    owner: { ...base, id: ownerUser.id, email: ownerUser.email, fullName: ownerUser.fullName, roleNames: ['Owner'], orgWidePermissions: new Set(ALL_PERMISSIONS) },
    viewer: {
      ...base,
      id: viewerUser.id,
      email: viewerUser.email,
      fullName: viewerUser.fullName,
      roleNames: ['Viewer'],
      orgWidePermissions: new Set(['job_card.view', 'customer.view', 'vehicle.view', 'inventory.view']),
    },
    technicianIds: technicians.map((t) => t.id),
    parts: createdParts,
  };
}

export async function expectDomainError(promise: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof DomainError, `expected DomainError, got ${String(error)}`);
    assert.match(error.message, pattern);
    return true;
  });
}

export const jobStatus = async (id: string) =>
  (await prisma.jobCard.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

export async function historyStatuses(jobCardId: string) {
  const rows = await prisma.jobStatusHistory.findMany({
    where: { jobCardId },
    orderBy: [{ changedAt: 'asc' }, { id: 'asc' }],
    select: { toStatus: true },
  });
  return rows.map((row) => row.toStatus);
}
