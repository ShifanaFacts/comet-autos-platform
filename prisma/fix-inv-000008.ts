/*
 * ONE-OFF — do not commit. Re-books INV-000008 (Shaloop) by the app's own rule.
 *
 * Its journal entry JV-000043 was changed by hand to
 *   Dr Customer advances 2,000 + Dr Trade receivables 1,500
 * but the advance is already taken off by its own entry, JV-000069
 * (Dr Customer advances 2,000 / Cr Trade receivables 2,000). So the advance
 * is counted twice: Shaloop shows −2,000 in receivables and −2,000 in
 * customer advances, where both should be 0.
 *
 * This runs syncPosting for the invoice — the same call every invoice change
 * makes — which REVERSES JV-000043 (nothing is edited or deleted) and books
 * the correct entry: Dr Trade receivables 3,500, Dr Sales discounts 146.68,
 * Cr VAT 166.68, Cr parts 1,180, Cr labour 2,300. Both on 2 Oct 2026.
 *
 *   npx tsx prisma/fix-inv-000008.ts           dry run: shows, then rolls back
 *   npx tsx prisma/fix-inv-000008.ts --apply   books it
 *
 * Refuses to run unless the data is exactly as found on 5 Oct 2026, and
 * rolls back unless Shaloop's receivables and advances both end at 0.00.
 */
import 'dotenv/config';
import { prisma } from '@/lib/prisma';
import { syncPosting } from '@/lib/accounting/journal';
import { writeAuditLog } from '@/lib/audit';

const ORG = '01a0d2e0-cc97-700a-9f8a-6b9834e20c27';
const INVOICE = '01a0fb81-d573-74dc-b579-a40d1ae627e5';
const PAYMENT = '01a0fb83-2206-7079-a4e5-7f33a2cf6a1e';
const ADVANCE = '01a10038-2a9d-73f4-9554-ad1d23abcbef';
const ALLOCATION = '01a10048-5e7d-7402-80e3-15d06cc1773e';
const ACTOR = '01a0d2e1-5041-7561-ba63-05efe9cf5421';
const APPLY = process.argv.includes('--apply');

class DryRun extends Error {}

type Line = { code: string; name: string; debit: string; credit: string };

async function entries(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) {
  const rows = await tx.journalEntry.findMany({
    where: { organizationId: ORG, sourceId: { in: [INVOICE, PAYMENT, ADVANCE, ALLOCATION] } },
    orderBy: { createdAt: 'asc' },
    include: { lines: { include: { chartOfAccount: true } } },
  });
  return rows.map((entry) => ({
    id: entry.id,
    number: entry.entryNumber,
    source: entry.sourceType,
    date: entry.entryDate.toISOString().slice(0, 10),
    reversalOf: entry.reversalOfJournalEntryId,
    description: entry.description,
    lines: entry.lines.map(
      (line): Line => ({
        code: line.chartOfAccount.accountCode,
        name: line.chartOfAccount.accountName,
        debit: line.debitAmount.toFixed(2),
        credit: line.creditAmount.toFixed(2),
      }),
    ),
  }));
}

function balances(list: Awaited<ReturnType<typeof entries>>) {
  const totals: Record<string, number> = { '1100': 0, '2030': 0 };
  for (const entry of list) {
    for (const line of entry.lines) {
      if (line.code in totals) {
        totals[line.code] += Math.round(Number(line.debit) * 100) - Math.round(Number(line.credit) * 100);
      }
    }
  }
  return {
    tradeReceivables: (totals['1100'] / 100).toFixed(2),
    customerAdvances: (totals['2030'] / 100).toFixed(2),
  };
}

function show(title: string, list: Awaited<ReturnType<typeof entries>>) {
  console.log(`\n${title}`);
  for (const entry of list) {
    console.log(`  ${entry.number}  ${entry.date}  ${entry.source}  ${entry.description}`);
    for (const line of entry.lines) {
      const amount = line.debit !== '0.00' ? `Dr ${line.debit}` : `            Cr ${line.credit}`;
      console.log(`      ${line.code} ${line.name.padEnd(38)} ${amount}`);
    }
  }
  const b = balances(list);
  console.log(`  → Trade receivables (1100): ${b.tradeReceivables}   Customer advances (2030): ${b.customerAdvances}`);
}

async function main() {
  console.log(APPLY ? 'APPLYING' : 'DRY RUN — nothing is saved. Add --apply to book it.');
  try {
    await prisma.$transaction(
      async (tx) => {
        const invoice = await tx.invoice.findFirstOrThrow({
          where: { id: INVOICE, organizationId: ORG },
          select: { invoiceNumber: true, status: true, totalAmount: true, advanceAppliedAmount: true, branchId: true },
        });
        if (
          invoice.invoiceNumber !== 'INV-000008' ||
          invoice.status !== 'PAID' ||
          invoice.totalAmount.toFixed(2) !== '3500.00' ||
          invoice.advanceAppliedAmount.toFixed(2) !== '2000.00'
        ) {
          throw new Error(`Invoice is not as found on 5 Oct: ${JSON.stringify(invoice)}`);
        }
        await tx.user.findFirstOrThrow({ where: { id: ACTOR, organizationId: ORG }, select: { id: true } });

        const before = await entries(tx);
        show('BEFORE', before);
        const standing = before.filter(
          (entry) =>
            entry.source === 'INVOICE' &&
            !entry.reversalOf &&
            !before.some((other) => other.reversalOf === entry.id),
        );
        const handEdited =
          standing.length === 1 &&
          standing[0].number === 'JV-000043' &&
          standing[0].lines.some((line) => line.code === '2030' && line.debit === '2000.00');
        if (!handEdited) throw new Error('JV-000043 is no longer as found — stopping, nothing changed.');

        const changed = await syncPosting(tx, ORG, 'INVOICE', INVOICE, ACTOR);
        if (!changed) throw new Error('syncPosting found nothing to change — stopping.');

        const after = await entries(tx);
        show('AFTER', after);
        const result = balances(after);
        if (result.tradeReceivables !== '0.00' || result.customerAdvances !== '0.00') {
          throw new Error(`Balances would not be 0.00 (${JSON.stringify(result)}) — rolled back.`);
        }

        await writeAuditLog(tx, {
          organizationId: ORG,
          branchId: invoice.branchId,
          actorUserId: ACTOR,
          action: 'invoice.reposted',
          entityType: 'Invoice',
          entityId: INVOICE,
          beforeData: { journalEntry: 'JV-000043', tradeReceivables: '-2000.00', customerAdvances: '-2000.00' },
          afterData: { tradeReceivables: '0.00', customerAdvances: '0.00' },
          metadata: {
            invoiceNumber: 'INV-000008',
            reason:
              'JV-000043 had been changed by hand to take the 2,000.00 advance off the invoice entry, while ADV-000001 is already applied by JV-000069 — the advance was counted twice. Reversed and booked again by the standard rule.',
          },
        });

        if (!APPLY) throw new DryRun();
      },
      { timeout: 60_000 },
    );
    console.log('\nDone — booked.');
  } catch (error) {
    if (error instanceof DryRun) console.log('\nDry run OK — rolled back. Run again with --apply.');
    else throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
