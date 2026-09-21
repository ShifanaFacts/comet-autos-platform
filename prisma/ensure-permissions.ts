/*
 * Brings the permission catalogue in the database up to date with
 * `src/lib/auth/permission-catalog.ts`, and grants the access-management
 * codes to the roles that already carried everything else.
 *
 *   npm run db:permissions
 *
 * Safe to run repeatedly and safe on live data: it only inserts rows that
 * are missing. It never deletes a permission, never revokes a grant, and
 * never touches business data.
 *
 * Why the backfill: `user.view`, `user.manage` and `role.manage` are new.
 * Without granting them, the workshop would have no one able to open the
 * access screens — while the people who had full access all along could
 * already do any of it directly in the database. Granting them only to
 * roles that already held every other permission changes nobody's real
 * reach; it just gives them a screen for what they could already do.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  ACCESS_PERMISSION_CODES,
  PERMISSION_CODES,
  PERMISSION_MODULES,
} from '../src/lib/auth/permission-catalog.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const detail = new Map(
    PERMISSION_MODULES.flatMap((module) =>
      module.permissions.map((permission) => [permission.code, permission.detail] as const),
    ),
  );

  let created = 0;
  for (const code of PERMISSION_CODES) {
    const before = await prisma.permission.findUnique({ where: { code }, select: { id: true } });
    await prisma.permission.upsert({
      where: { code },
      update: { description: detail.get(code) ?? null },
      create: { code, module: code.split('.')[0], description: detail.get(code) ?? null },
    });
    if (!before) created += 1;
  }
  console.log(`catalogue: ${PERMISSION_CODES.length} codes (${created} newly added)`);

  const access = await prisma.permission.findMany({
    where: { code: { in: ACCESS_PERMISSION_CODES } },
    select: { id: true, code: true },
  });
  const existing = await prisma.permission.findMany({
    where: { code: { notIn: ACCESS_PERMISSION_CODES } },
    select: { id: true },
  });
  const everythingElse = existing.map((permission) => permission.id);

  // Roles already holding every non-access permission: the full-access
  // roles. Anyone else keeps exactly the reach they have today.
  const roles = await prisma.role.findMany({
    select: {
      id: true,
      name: true,
      organizationId: true,
      rolePermissions: { select: { permissionId: true } },
    },
  });
  let granted = 0;
  for (const role of roles) {
    const held = new Set(role.rolePermissions.map((row) => row.permissionId));
    if (!everythingElse.every((id) => held.has(id))) continue;
    for (const permission of access) {
      if (held.has(permission.id)) continue;
      await prisma.rolePermission.create({
        data: { organizationId: role.organizationId, roleId: role.id, permissionId: permission.id },
      });
      granted += 1;
    }
  }
  console.log(`access codes granted to full-access roles: ${granted} new grant(s)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
