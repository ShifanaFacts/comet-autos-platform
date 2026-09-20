import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { prisma } from '@/lib/prisma';
async function main() {
  const s = JSON.parse(readFileSync('resp.json', 'utf8'));
  const rows = await prisma.expense.findMany({
    where: { organizationId: s.orgId },
    orderBy: { createdAt: 'desc' },
    select: { description: true, amount: true, taxAmount: true, status: true, createdAt: true },
  });
  console.log(JSON.stringify(rows, null, 1));
}
main().finally(() => prisma.$disconnect());
