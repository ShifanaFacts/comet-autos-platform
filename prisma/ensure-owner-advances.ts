/*
 * Gives account 2520 "Due to owner (current account)" the OWNER_ADVANCES
 * role in every workshop, so bills an owner pays personally are booked to
 * it and repayments come off it.
 *
 *   npm run db:owner-advances
 *
 * Safe to run repeatedly and on live data: a workshop whose account already
 * has the role is left alone; otherwise its existing 2520 (a liability with
 * no role) is given the role — never renamed, never moved — and only a
 * workshop without one gets the account created. It touches nothing else.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const CODE = '2520';
const NAME = 'Due to owner (current account)';

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const organizations = await prisma.organization.findMany({
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
    for (const organization of organizations) {
      const outcome = await prisma.$transaction(async (tx) => {
        const holder = await tx.chartOfAccount.findFirst({
          where: { organizationId: organization.id, role: 'OWNER_ADVANCES' },
          select: { accountCode: true, accountName: true },
        });
        if (holder) return `already set on ${holder.accountCode} ${holder.accountName}`;

        const existing = await tx.chartOfAccount.findFirst({
          where: { organizationId: organization.id, accountCode: CODE },
          select: { id: true, accountType: true, role: true, accountName: true },
        });
        if (existing && existing.accountType === 'LIABILITY' && !existing.role) {
          await tx.chartOfAccount.update({
            where: { id: existing.id },
            data: { role: 'OWNER_ADVANCES' },
          });
          return `role given to ${CODE} ${existing.accountName}`;
        }
        if (existing) {
          return `SKIPPED: ${CODE} is ${existing.accountName} (${existing.accountType}${existing.role ? `, ${existing.role}` : ''}) — assign the role by hand`;
        }
        // No chart yet (a workshop that has booked nothing): the app creates
        // it, with this role, the first time anything is booked.
        const charted = await tx.chartOfAccount.count({
          where: { organizationId: organization.id },
        });
        if (charted === 0) return 'no chart yet — created with the role on first booking';
        await tx.chartOfAccount.create({
          data: {
            organizationId: organization.id,
            accountCode: CODE,
            accountName: NAME,
            accountType: 'LIABILITY',
            role: 'OWNER_ADVANCES',
          },
        });
        return `created ${CODE} ${NAME}`;
      });
      console.log(`${organization.name}: ${outcome}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
