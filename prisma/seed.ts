// Dev-only seed data (section 42 of the V1 build instruction). Run with
// `npm run db:seed`. Never runs automatically against anything but the
// local dev database — there is no production/CI wiring for this script.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import bcrypt from 'bcryptjs';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// The permission catalogue lives in one place so the seed, the
// `db:permissions` script and the access screens can never disagree.
// Permission is a global platform catalog (no organizationId) — see its
// schema comment.
import { PERMISSION_CODES } from '../src/lib/auth/permission-catalog.js';

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
        create: {
          organizationId: organization.id,
          roleId: ownerRole.id,
          permissionId: permission.id,
        },
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

  // Workshop staff. Inspections, diagnoses and job assignments are always
  // attributed to an Employee (never a User), so the workflow needs at least
  // one. The owner doubles as the service advisor; technicians have no login.
  const sampleEmployees = [
    {
      employeeCode: 'EMP-001',
      firstName: 'Shifana',
      lastName: '',
      jobTitle: 'Service Advisor',
      userId: ownerUser.id,
    },
    {
      employeeCode: 'EMP-002',
      firstName: 'Rajesh',
      lastName: 'Kumar',
      jobTitle: 'Senior Technician',
      userId: null,
    },
    {
      employeeCode: 'EMP-003',
      firstName: 'Omar',
      lastName: 'Farooq',
      jobTitle: 'Technician',
      userId: null,
    },
    {
      employeeCode: 'EMP-004',
      firstName: 'Joel',
      lastName: 'Mathew',
      jobTitle: 'Technician',
      userId: null,
    },
  ];
  for (const employee of sampleEmployees) {
    await prisma.employee.upsert({
      where: {
        organizationId_employeeCode: {
          organizationId: organization.id,
          employeeCode: employee.employeeCode,
        },
      },
      update: {},
      create: {
        organizationId: organization.id,
        branchId: branch.id,
        hireDate: new Date('2024-01-01T00:00:00Z'),
        ...employee,
      },
    });
  }

  // Development parts catalog + opening stock, so the repair workflow can be
  // exercised. Dev data only — nothing in the application depends on these
  // SKUs. Safe to re-run: parts upsert by SKU, and opening stock is written
  // only for a part that has no stock movements at this branch yet.
  // Opening stock is an OPENING_STOCK ledger row (stock is always the sum of
  // the ledger — there is no stock counter to set). Rows written by earlier
  // runs are ADJUSTMENTs and are left as they are.
  const sampleParts = [
    {
      sku: 'OIL-5W30-1L',
      name: 'Engine oil 5W-30 (1 L)',
      unitOfMeasure: 'litre',
      cost: '18.00',
      price: '32.00',
      reorder: '20',
      opening: '120',
    },
    {
      sku: 'FLT-OIL-STD',
      name: 'Oil filter',
      unitOfMeasure: 'piece',
      cost: '14.00',
      price: '28.00',
      reorder: '10',
      opening: '40',
    },
    {
      sku: 'FLT-AIR-STD',
      name: 'Air filter',
      unitOfMeasure: 'piece',
      cost: '22.00',
      price: '45.00',
      reorder: '8',
      opening: '25',
    },
    {
      sku: 'FLT-CABIN',
      name: 'Cabin (AC) filter',
      unitOfMeasure: 'piece',
      cost: '20.00',
      price: '42.00',
      reorder: '8',
      opening: '20',
    },
    {
      sku: 'BRK-PAD-FRT',
      name: 'Brake pad set (front)',
      unitOfMeasure: 'set',
      cost: '95.00',
      price: '180.00',
      reorder: '4',
      opening: '12',
    },
    {
      sku: 'BRK-DSC-FRT',
      name: 'Brake disc (front)',
      unitOfMeasure: 'piece',
      cost: '140.00',
      price: '260.00',
      reorder: '4',
      opening: '8',
    },
    {
      sku: 'IGN-PLUG',
      name: 'Spark plug',
      unitOfMeasure: 'piece',
      cost: '16.00',
      price: '35.00',
      reorder: '16',
      opening: '48',
    },
    {
      sku: 'CLT-1L',
      name: 'Coolant (1 L)',
      unitOfMeasure: 'litre',
      cost: '12.00',
      price: '25.00',
      reorder: '15',
      opening: '60',
    },
    {
      sku: 'BRK-FLD-DOT4',
      name: 'Brake fluid DOT 4 (500 ml)',
      unitOfMeasure: 'bottle',
      cost: '15.00',
      price: '30.00',
      reorder: '6',
      opening: '20',
    },
    {
      sku: 'WPR-BLD-PR',
      name: 'Wiper blades (pair)',
      unitOfMeasure: 'pair',
      cost: '35.00',
      price: '70.00',
      reorder: '5',
      opening: '15',
    },
    {
      sku: 'AC-CLUTCH',
      name: 'AC compressor clutch assembly',
      unitOfMeasure: 'piece',
      cost: '310.00',
      price: '480.00',
      reorder: '1',
      opening: '3',
    },
    {
      sku: 'AC-GAS-R134',
      name: 'AC refrigerant R134a (kg)',
      unitOfMeasure: 'kg',
      cost: '45.00',
      price: '90.00',
      reorder: '5',
      opening: '15',
    },
  ];
  for (const sample of sampleParts) {
    const part = await prisma.part.upsert({
      where: { organizationId_sku: { organizationId: organization.id, sku: sample.sku } },
      update: {},
      create: {
        organizationId: organization.id,
        sku: sample.sku,
        name: sample.name,
        unitOfMeasure: sample.unitOfMeasure,
        defaultCostPrice: sample.cost,
        defaultSellingPrice: sample.price,
        defaultTaxRate: '5.00',
        reorderLevel: sample.reorder,
      },
    });
    const movements = await prisma.inventoryTransaction.count({
      where: { organizationId: organization.id, branchId: branch.id, partId: part.id },
    });
    if (movements === 0) {
      await prisma.inventoryTransaction.create({
        data: {
          organizationId: organization.id,
          branchId: branch.id,
          partId: part.id,
          transactionType: 'OPENING_STOCK',
          quantity: sample.opening,
          unitCost: sample.cost,
          performedByUserId: ownerUser.id,
          note: 'Opening stock (development seed)',
        },
      });
    }
  }

  const sampleCustomers = [
    {
      name: 'Ahmed Al Marzooqi',
      phone: '0501234567',
      plateNumber: 'A 12345',
      make: 'Toyota',
      model: 'Land Cruiser',
      year: 2021,
    },
    {
      name: 'Fatima Hassan',
      phone: '0559876543',
      plateNumber: 'B 54321',
      make: 'Nissan',
      model: 'Patrol',
      year: 2019,
    },
    {
      name: 'Rashid Transport LLC',
      phone: '0521112223',
      plateNumber: 'C 77889',
      make: 'Mitsubishi',
      model: 'Canter',
      year: 2020,
    },
  ];

  for (const sample of sampleCustomers) {
    // Customer has no unique constraint on phone (only an index) — find-then-
    // create rather than upsert.
    const customer =
      (await prisma.customer.findFirst({
        where: { organizationId: organization.id, phone: sample.phone },
      })) ??
      (await prisma.customer.create({
        data: { organizationId: organization.id, name: sample.name, phone: sample.phone },
      }));

    await prisma.vehicle.upsert({
      where: {
        organizationId_plateNumber: {
          organizationId: organization.id,
          plateNumber: sample.plateNumber,
        },
      },
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

  // Expense categories, as EXPENSE accounts on the chart of accounts. Safe
  // to re-run: each upserts by account code and existing rows are left
  // alone, so a workshop that has renamed one keeps its wording.
  const EXPENSE_ACCOUNTS = [
    { code: '5100', name: 'Rent' },
    { code: '5110', name: 'Utilities' },
    { code: '5120', name: 'Workshop supplies' },
    { code: '5130', name: 'Equipment & tools' },
    { code: '5140', name: 'Vehicle & transport' },
    { code: '5150', name: 'Repairs & maintenance' },
    { code: '5160', name: 'Salaries & wages' },
    { code: '5170', name: 'Marketing' },
    { code: '5180', name: 'Government & licence fees' },
    { code: '5900', name: 'Other operating expenses' },
  ];
  for (const account of EXPENSE_ACCOUNTS) {
    await prisma.chartOfAccount.upsert({
      where: {
        organizationId_accountCode: {
          organizationId: organization.id,
          accountCode: account.code,
        },
      },
      update: {},
      create: {
        organizationId: organization.id,
        accountCode: account.code,
        accountName: account.name,
        accountType: 'EXPENSE',
      },
    });
  }

  console.log('Seed complete.');
  console.log(`  Organization: ${organization.name} (${organization.id})`);
  console.log(`  Expense categories: ${EXPENSE_ACCOUNTS.length}`);
  console.log(`  Branch: ${branch.name}`);
  console.log(`  Owner login: ${SEED_OWNER_EMAIL} / ${SEED_OWNER_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
