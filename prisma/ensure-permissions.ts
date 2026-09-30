/*
 * Brings the permission catalogue in the database up to date with
 * `src/lib/auth/permission-catalog.ts`.
 *
 *   npm run db:permissions
 *
 * The first run after the module × action catalogue arrived also upgrades
 * every role: each old code a role held is swapped for the new codes that
 * guard the very same screens and actions (the table below), so nobody gains
 * or loses anything. The system role (Owner) simply gets every code. Old
 * codes are then removed from the catalogue. It is one transaction — it
 * either all happens or none of it does — and every role that changes gets
 * an audit entry with its before and after.
 *
 * Safe to run repeatedly: once the catalogue is upgraded (the `audit.view`
 * code exists), later runs only add codes that are missing, make sure the
 * Owner role still holds every one, and print the summary. It never touches
 * business data.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  PERMISSION_CODES,
  PERMISSION_MODULES,
  permissionDetail,
} from '../src/lib/auth/permission-catalog.js';

/**
 * Old code → the new codes that now guard what it used to guard.
 *
 * Read it as: "every screen or action that used to check the old code now
 * checks one of these". Each new code comes from exactly one old code, with
 * one deliberate exception, marked FOLD: `job_card.assign` and
 * `job_card.close` both become `job_card.approve` (assign technicians, hand
 * the vehicle back) — the grid has six actions and these are the workshop's
 * two sign-offs on a job.
 *
 * A role holding only one side of the fold is reported by the script so an
 * admin can adjust it. No role in the live workshop is in that position.
 *
 * Old codes that guarded nothing (`payment.view`, `payroll.export`) map to
 * nothing. `audit.view` and `audit.export` are new, and only the Owner
 * starts with them.
 */
export const OLD_TO_NEW: Record<string, string[]> = {
  'job_card.view': ['job_card.view', 'job_card.export', 'quotation.view', 'quotation.export'],
  'job_card.create': [
    'job_card.create',
    'appointment.view',
    'appointment.create',
    'appointment.edit',
    'appointment.delete',
  ],
  'job_card.edit': [
    'job_card.edit',
    'job_card.delete',
    'quotation.create',
    'quotation.edit',
    'quotation.delete',
    'quotation.approve',
  ],
  'job_card.assign': ['job_card.approve'], // FOLD
  'job_card.close': ['job_card.approve'], // FOLD

  'customer.view': ['customer.view', 'customer.export'],
  'customer.create': ['customer.create'],
  'customer.edit': ['customer.edit', 'customer.delete'],

  'vehicle.view': ['vehicle.view', 'vehicle.export'],
  'vehicle.create': ['vehicle.create'],
  'vehicle.edit': ['vehicle.edit', 'vehicle.delete'],

  'inventory.view': [
    'inventory.view',
    'inventory.export',
    'purchase.view',
    'purchase.export',
    'supplier_payment.view',
  ],
  'inventory.issue': ['inventory.edit'],
  'inventory.adjust': ['inventory.approve'],
  'inventory.manage': ['inventory.create', 'inventory.delete'],

  'purchase.create': ['purchase.create', 'purchase.edit', 'purchase.delete'],
  'purchase.receive': ['purchase.approve'],

  'invoice.view': [
    'invoice.view',
    'invoice.export',
    'payment.view',
    'payment.export',
    'credit_note.view',
  ],
  'invoice.create': ['invoice.create', 'invoice.edit'],
  'invoice.cancel': ['invoice.delete', 'credit_note.create', 'credit_note.delete'],

  'payment.view': [],
  'payment.create': ['payment.create'],
  'payment.reverse': ['payment.delete'],

  'accounting.view': [
    'accounting.view',
    'expense.view',
    'vat.view',
    'reports.view',
    'settings.view',
  ],
  'accounting.create': ['expense.create', 'supplier_payment.create'],
  'accounting.edit': [
    'accounting.create',
    'accounting.edit',
    'accounting.delete',
    'accounting.approve',
    'expense.edit',
    'expense.delete',
    'supplier_payment.delete',
    'vat.create',
    'settings.create',
    'settings.edit',
  ],
  'accounting.export': ['reports.export'],

  'payroll.view': ['employee.view', 'attendance.view', 'leave.view'],
  'payroll.create': [
    'employee.create',
    'employee.edit',
    'attendance.create',
    'attendance.edit',
    'leave.create',
    'leave.delete',
    'payroll.view',
    'payroll.create',
    'payroll.edit',
    'payroll.delete',
  ],
  'payroll.approve': ['leave.approve', 'payroll.approve'],
  'payroll.export': [],

  'user.view': ['user.view', 'role.view'],
  'user.manage': ['user.create', 'user.edit', 'user.delete'],
  'role.manage': ['role.create', 'role.edit'],
};

/** Codes a role holds after the upgrade. The system role gets everything. */
export function upgradeCodes(oldCodes: Iterable<string>, isSystem = false): string[] {
  if (isSystem) return [...PERMISSION_CODES];
  const next = new Set<string>();
  for (const code of oldCodes) for (const target of OLD_TO_NEW[code] ?? []) next.add(target);
  return PERMISSION_CODES.filter((code) => next.has(code));
}

/** A role holding one side of a fold but not the other: worth a look. */
export function foldWarnings(oldCodes: Iterable<string>): string[] {
  const held = new Set(oldCodes);
  const warnings: string[] = [];
  if (held.has('job_card.assign') !== held.has('job_card.close')) {
    warnings.push(
      `had only ${held.has('job_card.assign') ? 'job_card.assign' : 'job_card.close'}; now holds job_card.approve (assign technicians AND hand vehicles back)`,
    );
  }
  return warnings;
}

/** "customer: view create edit · vehicle: view" — a role in one line per module. */
function describe(codes: string[]) {
  const byModule = new Map<string, string[]>();
  for (const code of codes) {
    const [module, action] = code.split('.');
    byModule.set(module, [...(byModule.get(module) ?? []), action]);
  }
  return [...byModule].map(([module, actions]) => `${module}: ${actions.join(' ')}`);
}

const UPGRADE_MARKER = 'audit.view';

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const upgraded = await prisma.permission.findUnique({
      where: { code: UPGRADE_MARKER },
      select: { id: true },
    });

    await prisma.$transaction(
      async (tx) => {
        let added = 0;
        for (const code of PERMISSION_CODES) {
          const before = await tx.permission.findUnique({ where: { code }, select: { id: true } });
          await tx.permission.upsert({
            where: { code },
            update: { module: code.split('.')[0], description: permissionDetail(code) },
            create: { code, module: code.split('.')[0], description: permissionDetail(code) },
          });
          if (!before) added += 1;
        }
        console.log(
          `catalogue: ${PERMISSION_CODES.length} codes in ${PERMISSION_MODULES.length} modules (${added} newly added)`,
        );

        const ids = new Map(
          (
            await tx.permission.findMany({
              where: { code: { in: PERMISSION_CODES } },
              select: { id: true, code: true },
            })
          ).map((row) => [row.code, row.id]),
        );

        const roles = await tx.role.findMany({
          select: {
            id: true,
            name: true,
            isSystem: true,
            organizationId: true,
            organization: { select: { name: true } },
            rolePermissions: { select: { permission: { select: { code: true } } } },
          },
          orderBy: [{ organizationId: 'asc' }, { name: 'asc' }],
        });

        for (const role of roles) {
          const before = role.rolePermissions.map((row) => row.permission.code).sort();
          // Before the upgrade a role's codes are old codes, to translate.
          // After it they are already new codes — only the system role is
          // topped up, so a code added to the catalogue later reaches it.
          const after = !upgraded
            ? upgradeCodes(before, role.isSystem)
            : role.isSystem
              ? [...PERMISSION_CODES]
              : PERMISSION_CODES.filter((code) => before.includes(code));
          const changed =
            before.length !== after.length || before.some((code) => !after.includes(code));

          console.log(
            `\n${role.name}${role.isSystem ? ' (system)' : ''} — ${role.organization.name}`,
          );
          console.log(`  before: ${before.length} codes`);
          for (const line of describe(before)) console.log(`    ${line}`);
          console.log(`  after:  ${after.length} codes${changed ? '' : ' (unchanged)'}`);
          for (const line of describe(after)) console.log(`    ${line}`);
          if (!upgraded && !role.isSystem) {
            for (const warning of foldWarnings(before)) console.log(`  NOTE: ${warning}`);
          }
          if (!changed) continue;

          await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
          await tx.rolePermission.createMany({
            data: after.map((code) => ({
              organizationId: role.organizationId,
              roleId: role.id,
              permissionId: ids.get(code)!,
            })),
          });
          await tx.auditLog.create({
            data: {
              organizationId: role.organizationId,
              action: 'role.permissions_changed',
              entityType: 'Role',
              entityId: role.id,
              beforeData: { name: role.name, permissions: before },
              afterData: { name: role.name, permissions: after },
              metadata: {
                reason: upgraded
                  ? 'Permission catalogue updated'
                  : 'Permissions upgraded to the module × action grid; access unchanged',
              },
            },
          });
        }

        // Codes no longer in the catalogue: nothing holds them any more.
        const stale = await tx.permission.findMany({
          where: { code: { notIn: PERMISSION_CODES } },
          select: { id: true, code: true },
        });
        if (stale.length > 0) {
          await tx.rolePermission.deleteMany({
            where: { permissionId: { in: stale.map((row) => row.id) } },
          });
          await tx.permission.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
          console.log(
            `\nretired ${stale.length} old code(s): ${stale.map((row) => row.code).join(', ')}`,
          );
        }
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
    console.log(upgraded ? '\nalready on the grid catalogue — checked.' : '\nupgrade complete.');
  } finally {
    await prisma.$disconnect();
  }
}

// Run only as a script, so the mapping can be imported by tests.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('prisma/ensure-permissions.ts')) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
