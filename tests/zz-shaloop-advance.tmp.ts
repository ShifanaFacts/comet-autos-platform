/**
 * ONE-OFF, for the live garage: Shaloop's 2,000.00 advance (ADV-000001, card,
 * 1 Oct) was used towards INV-000009 (3,500.00), so on 2 Oct he paid only
 * 1,500.00 by card — but RCT-000009 recorded 3,500.00, and a 2,000.00 cash
 * refund of the advance was then recorded by mistake. Put right through the
 * app's own actions, as the person who took the payment:
 *
 *   0. reverseAdvanceRefund               the 2,000.00 cash "refund" of 3 Oct
 *                                          undone: its entry reversed, the
 *                                          advance held for Shaloop again
 *   1. reverseInvoicePayment(RCT-000009)   the 3,500.00 stays on record as
 *                                          reversed; 3,500.00 owed again
 *   2. applyCustomerAdvance(ADV-000001)    2,000.00 to INV-000009, on 2 Oct:
 *                                          Dr Customer advances, Cr receivables
 *   3. recordInvoicePayment                1,500.00 by card, 2 Oct, the same
 *                                          time and account as RCT-000009
 *
 * After: INV-000009 3,500.00 = advance 2,000.00 + paid 1,500.00, PAID;
 * JC-000008 PAID; ADV-000001 fully applied; cash on hand back as it was;
 * card settlements 2,000 + 1,500. Re-runnable: a step already done is skipped.
 *
 *   npx tsx tests/zz-shaloop-advance.tmp.ts            (dry run: checks, changes nothing)
 *   npx tsx tests/zz-shaloop-advance.tmp.ts --apply    (makes the change)
 *
 * Delete this file afterwards.
 */
import 'dotenv/config';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { reverseInvoicePayment } from '@/lib/billing/invoice-changes';
import { applyCustomerAdvance, reverseAdvanceRefund } from '@/lib/billing/advances';
import { getInvoiceDetail, recordInvoicePayment } from '@/lib/billing/invoice';
import { countUnbooked } from '@/lib/accounting/entries';
import { toLocalDateTimeInput } from '@/lib/format';

const ORG = '01a0d2e0-cc97-700a-9f8a-6b9834e20c27';
const INVOICE = '01a0fb81-d573-74dc-b579-a40d1ae627e5';
const JOB = '01a0e922-f4b5-7199-8260-df667b4d360b';
const PAYMENT = '01a0fb83-2206-7079-a4e5-7f33a2cf6a1e';
const ADVANCE = '01a10038-2a9d-73f4-9554-ad1d23abcbef';
const REFUND = '01a1003d-4b1e-76f8-9afe-68b1a930a736';
const APPLIED_ON = '2026-10-02';
const APPLY = process.argv.includes('--apply');

class Stop extends Error {}
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Stop(message);
  console.log(`  ok  ${message}`);
}

/** The person, with their permissions, exactly as a signed-in session has them. */
async function actorFor(userId: string): Promise<AuthenticatedUser> {
  const user = await prisma.user.findFirstOrThrow({
    where: { id: userId, organizationId: ORG },
    include: {
      userRoles: {
        where: { revokedAt: null },
        include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
      },
    },
  });
  const orgWidePermissions = new Set<string>();
  const branchPermissions = new Map<string, Set<string>>();
  for (const userRole of user.userRoles) {
    const codes = userRole.role.rolePermissions.map((rp) => rp.permission.code);
    if (userRole.branchId === null) codes.forEach((code) => orgWidePermissions.add(code));
    else {
      const existing = branchPermissions.get(userRole.branchId) ?? new Set<string>();
      codes.forEach((code) => existing.add(code));
      branchPermissions.set(userRole.branchId, existing);
    }
  }
  return {
    id: user.id,
    organizationId: user.organizationId,
    primaryBranchId: user.primaryBranchId,
    email: user.email,
    fullName: user.fullName,
    roleNames: [...new Set(user.userRoles.map((userRole) => userRole.role.name))],
    orgWidePermissions,
    branchPermissions,
  };
}

const can = (user: AuthenticatedUser, code: string, branchId: string) =>
  user.orgWidePermissions.has(code) || !!user.branchPermissions.get(branchId)?.has(code);

async function state() {
  const [invoice, payments, advance, job] = await Promise.all([
    prisma.invoice.findUniqueOrThrow({
      where: { id: INVOICE },
      select: {
        invoiceNumber: true,
        status: true,
        branchId: true,
        customerId: true,
        totalAmount: true,
        creditedAmount: true,
        settlementDiscount: true,
        advanceAppliedAmount: true,
      },
    }),
    prisma.payment.findMany({
      where: { invoiceId: INVOICE },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        paymentNumber: true,
        amount: true,
        method: true,
        status: true,
        accountId: true,
        receivedAt: true,
        receivedByUserId: true,
        reversalOfPaymentId: true,
      },
    }),
    prisma.customerAdvance.findUniqueOrThrow({
      where: { id: ADVANCE },
      select: {
        advanceNumber: true,
        status: true,
        amount: true,
        customerId: true,
        allocations: { select: { invoiceId: true, amount: true, reversedAt: true } },
        refunds: {
          select: { id: true, amount: true, method: true, refundedOn: true, reversedAt: true },
        },
      },
    }),
    prisma.jobCard.findUniqueOrThrow({ where: { id: JOB }, select: { status: true } }),
  ]);
  return { invoice, payments, advance, job };
}

async function main() {
  console.log(APPLY ? 'APPLY\n' : 'DRY RUN — nothing will be changed\n');
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: ORG },
    select: { name: true },
  });
  check(/MOHAMMED MOWLA/i.test(org.name), `organization is ${org.name}`);

  const s = await state();
  check(s.invoice.invoiceNumber === 'INV-000009', `invoice ${s.invoice.invoiceNumber}`);
  check(s.invoice.totalAmount.toString() === '3500', `invoice total ${s.invoice.totalAmount}`);
  check(
    s.invoice.creditedAmount.toString() === '0' && s.invoice.settlementDiscount.toString() === '0',
    'nothing credited, no discount off the total',
  );
  check(
    s.advance.advanceNumber === 'ADV-000001' &&
      s.advance.amount.toString() === '2000' &&
      s.advance.customerId === s.invoice.customerId,
    `${s.advance.advanceNumber} ${s.advance.amount}, the same customer as the invoice`,
  );

  // The mistaken refund: undone here, or already removed by hand.
  check(s.advance.refunds.length <= 1, `${s.advance.refunds.length} refund on ADV-000001`);
  const refund = s.advance.refunds[0];
  const refundUndone = !refund || refund.reversedAt !== null;
  if (refund) {
    check(
      refund.id === REFUND && refund.amount.toString() === '2000' && refund.method === 'CASH',
      `the mistaken refund: ${refund.amount} ${refund.method} on ${refund.refundedOn.toISOString().slice(0, 10)}${refundUndone ? ' (already undone)' : ''}`,
    );
  } else {
    console.log('  --  the mistaken refund is already gone');
  }
  const advanceEntry = await prisma.journalEntry.findFirst({
    where: { organizationId: ORG, sourceType: 'CUSTOMER_ADVANCE', sourceId: ADVANCE },
    select: { entryNumber: true },
  });
  check(advanceEntry, `the advance is in the books (${advanceEntry?.entryNumber})`);

  const original = s.payments.find((p) => p.id === PAYMENT);
  check(
    original &&
      original.paymentNumber === 'RCT-000009' &&
      original.amount.toString() === '3500' &&
      original.method === 'CARD',
    `RCT-000009 ${original?.amount} ${original?.method}`,
  );
  const reversed = s.payments.some((p) => p.reversalOfPaymentId === PAYMENT);
  const applied = s.advance.allocations.some(
    (a) => a.invoiceId === INVOICE && !a.reversedAt && a.amount.toString() === '2000',
  );
  if (!applied) check(s.advance.allocations.length === 0, 'nothing applied from ADV-000001 yet');
  const others = s.payments.filter((p) => p.id !== PAYMENT && p.reversalOfPaymentId !== PAYMENT);
  const repaid = others.some(
    (p) => p.amount.toString() === '1500' && p.status === 'COMPLETED' && !p.reversalOfPaymentId,
  );
  check(others.length === (repaid ? 1 : 0), 'no other payment on the invoice');

  const actor = await actorFor(original.receivedByUserId);
  for (const code of [
    'customer_advance.delete',
    'payment.delete',
    'customer_advance.edit',
    'payment.create',
  ]) {
    check(can(actor, code, s.invoice.branchId), `${actor.fullName} may ${code}`);
  }

  const receivedAt = toLocalDateTimeInput(original.receivedAt);
  if (!APPLY) {
    console.log('\nWould:');
    if (!refundUndone) {
      console.log(
        '  0. undo the 2,000.00 cash refund of 3 Oct — its entry reversed, the advance held again',
      );
    }
    if (!reversed)
      console.log('  1. reverse RCT-000009 (3,500.00) — kept on record, 3,500.00 owed again');
    if (!applied) console.log(`  2. apply ADV-000001 2,000.00 to INV-000009 on ${APPLIED_ON}`);
    if (!repaid) {
      console.log(
        `  3. record 1,500.00 by card at ${receivedAt} into the same account as RCT-000009`,
      );
    }
    if (refundUndone && reversed && applied && repaid) console.log('  (nothing — already done)');
    console.log('\nRun again with --apply to make the change.');
    return;
  }

  if (!refundUndone) {
    await reverseAdvanceRefund(actor, REFUND, {
      reason:
        'Recorded by mistake: the advance was used towards INV-000009, nothing was paid back.',
    });
    console.log('  done  0. the mistaken refund undone');
  }
  if (!reversed) {
    await reverseInvoicePayment(actor, PAYMENT, {
      reason:
        'Recorded as 3,500.00 by mistake: 2,000.00 came from advance ADV-000001; 1,500.00 was paid by card.',
    });
    console.log('  done  1. RCT-000009 reversed');
  }
  if (!applied) {
    await applyCustomerAdvance(actor, ADVANCE, {
      invoiceId: INVOICE,
      amount: '2000',
      allocatedOn: APPLIED_ON,
    });
    console.log('  done  2. ADV-000001 applied, 2,000.00');
  }
  if (!repaid) {
    const payment = await recordInvoicePayment(actor, INVOICE, {
      amount: '1500',
      method: 'CARD',
      receivedAt,
      accountId: original.accountId ?? '',
      notes: 'Balance after advance ADV-000001 (replaces RCT-000009).',
    });
    console.log(`  done  3. ${payment.paymentNumber} 1,500.00 by card`);
  }

  // Verify.
  const after = await state();
  const detail = await getInvoiceDetail(actor, INVOICE);
  console.log('');
  check(
    after.advance.refunds.every((r) => r.reversedAt),
    'the mistaken refund is undone',
  );
  check(
    after.invoice.advanceAppliedAmount.toString() === '2000',
    `advance applied ${after.invoice.advanceAppliedAmount}`,
  );
  check(detail.paidAmount === '1500.00', `paid ${detail.paidAmount}`);
  check(detail.balanceDue === '0.00', `balance ${detail.balanceDue}`);
  check(after.invoice.status === 'PAID', `INV-000009 ${after.invoice.status}`);
  check(after.job.status === 'PAID', `JC-000008 ${after.job.status}`);
  check(after.advance.status === 'FULLY_APPLIED', `ADV-000001 ${after.advance.status}`);
  if (can(actor, 'accounting.view', after.invoice.branchId)) {
    check((await countUnbooked(actor)) === 0, 'nothing left unbooked');
  }
  const totals = await prisma.$queryRaw<{ d: string; c: string }[]>`
    SELECT COALESCE(SUM(debit_amount),0)::text d, COALESCE(SUM(credit_amount),0)::text c
    FROM journal_entry_lines WHERE organization_id = ${ORG}::uuid`;
  check(totals[0].d === totals[0].c, `books balance (${totals[0].d})`);
  console.log('\nDone. Delete this script.');
}

main()
  .catch((error) => {
    console.error(error instanceof Stop ? `\nSTOPPED: ${error.message}` : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
