// Dev-only seed data (section 42 of the V1 build instruction). Run with
// `npm run db:seed`. Never runs automatically against anything but the
// local dev database — there is no production/CI wiring for this script.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import bcrypt from 'bcryptjs';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// V1 permission catalog, taken directly from section 25 of the build
// instruction (plus a `vehicle.*` set by analogy to `customer.*`, since
// Quick Check-In creates vehicles as well as customers). Permission is a
// global platform catalog (no organizationId) — see its schema comment.
const PERMISSION_CODES = [
  'job_card.view',
  'job_card.create',
  'job_card.edit',
  'job_card.assign',
  'job_card.close',
  'customer.view',
  'customer.create',
  'customer.edit',
  'vehicle.view',
  'vehicle.create',
  'vehicle.edit',
  'invoice.view',
  'invoice.create',
  'invoice.cancel',
  'payment.view',
  'payment.create',
  'payment.reverse',
  'inventory.view',
  'inventory.adjust',
  'inventory.issue',
  'accounting.view',
  'accounting.create',
  'accounting.edit',
  'accounting.export',
  'payroll.view',
  'payroll.create',
  'payroll.approve',
  'payroll.export',
];

const SEED_OWNER_EMAIL = 'shifanachennara@gmail.com';
// Dev-only default password — change immediately in any non-local
// environment. This script never runs outside local development.
const SEED_OWNER_PASSWORD = 'CometAutos#2026';

async function main() {
  const organization = await prisma.organization.upsert({
    where: { id: '00000000-0000-7000-8000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-7000-8000-000000000001',
      name: 'Comet Autos',
      legalName: 'Comet Autos Workshop LLC',
      address: 'Al Qusais, Dubai, UAE',
      baseCurrency: 'AED',
    },
  });

  const branch = await prisma.branch.upsert({
    where: { organizationId_code: { organizationId: organization.id, code: 'AQ' } },
    update: {},
    create: {
      organizationId: organization.id,
      code: 'AQ',
      name: 'Al Qusais',
      address: 'Al Qusais, Dubai, UAE',
    },
  });

  const permissions = await Promise.all(
    PERMISSION_CODES.map((code) =>
      prisma.permission.upsert({
        where: { code },
        update: {},
        create: { code, module: code.split('.')[0] },
      }),
    ),
  );

  const ownerRole = await prisma.role.upsert({
    where: { organizationId_name: { organizationId: organization.id, name: 'Owner' } },
    update: {},
    create: {
      organizationId: organization.id,
      name: 'Owner',
      description: 'Full access to every module.',
      isSystem: true,
    },
  });

  await Promise.all(
    permissions.map((permission) =>
      prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: ownerRole.id, permissionId: permission.id } },
        update: {},
        create: { organizationId: organization.id, roleId: ownerRole.id, permissionId: permission.id },
      }),
    ),
  );

  const passwordHash = await bcrypt.hash(SEED_OWNER_PASSWORD, 12);
  const ownerUser = await prisma.user.upsert({
    where: { organizationId_email: { organizationId: organization.id, email: SEED_OWNER_EMAIL } },
    update: {},
    create: {
      organizationId: organization.id,
      primaryBranchId: branch.id,
      email: SEED_OWNER_EMAIL,
      passwordHash,
      fullName: 'Shifana',
    },
  });

  const existingOwnerGrant = await prisma.userRole.findFirst({
    where: { userId: ownerUser.id, roleId: ownerRole.id, branchId: null, revokedAt: null },
  });
  if (!existingOwnerGrant) {
    await prisma.userRole.create({
      data: { organizationId: organization.id, userId: ownerUser.id, roleId: ownerRole.id },
    });
  }

  const sampleCustomers = [
    { name: 'Ahmed Al Marzooqi', phone: '0501234567', plateNumber: 'A 12345', make: 'Toyota', model: 'Land Cruiser', year: 2021 },
    { name: 'Fatima Hassan', phone: '0559876543', plateNumber: 'B 54321', make: 'Nissan', model: 'Patrol', year: 2019 },
    { name: 'Rashid Transport LLC', phone: '0521112223', plateNumber: 'C 77889', make: 'Mitsubishi', model: 'Canter', year: 2020 },
  ];

  for (const sample of sampleCustomers) {
    // Customer has no unique constraint on phone (only an index) — find-then-
    // create rather than upsert.
    const customer =
      (await prisma.customer.findFirst({ where: { organizationId: organization.id, phone: sample.phone } })) ??
      (await prisma.customer.create({
        data: { organizationId: organization.id, name: sample.name, phone: sample.phone },
      }));

    await prisma.vehicle.upsert({
      where: { organizationId_plateNumber: { organizationId: organization.id, plateNumber: sample.plateNumber } },
      update: {},
      create: {
        organizationId: organization.id,
        customerId: customer.id,
        plateNumber: sample.plateNumber,
        make: sample.make,
        model: sample.model,
        year: sample.year,
      },
    });
  }

  console.log('Seed complete.');
  console.log(`  Organization: ${organization.name} (${organization.id})`);
  console.log(`  Branch: ${branch.name}`);
  console.log(`  Owner login: ${SEED_OWNER_EMAIL} / ${SEED_OWNER_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
