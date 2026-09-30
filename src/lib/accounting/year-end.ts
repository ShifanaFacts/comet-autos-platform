import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { writeAuditLog } from '@/lib/audit';
import { DomainError, NotFoundError } from '@/lib/errors';
import { parseInput } from '@/lib/form-data';
import { filsToString, toFils } from '@/lib/money';
import { localDateString, parseCalendarDate } from '@/lib/format';
import { ensureChart } from '@/lib/accounting/chart';
import { bookEntry, reverseEntry } from '@/lib/accounting/journal';

/*
 * Year-end closing.
 *
 * At the end of a financial year every income and expense account is brought
 * to zero and the year's profit (or loss) is moved into Retained earnings —
 * one journal entry, source YEAR_END_CLOSE, dated on the last day of the
 * year. The next year's profit and loss then starts from nothing, and the
 * balance sheet carries last year's result inside retained earnings.
 *
 *   for each income account     Dr the account   its credit balance
 *   for each expense account    Cr the account   its debit balance
 *   the difference              Cr Retained earnings (a profit)
 *                               Dr Retained earnings (a loss)
 *
 * A closing entry is dated inside the period it closes, which is normally
 * already closed by a VAT return — it is the one entry allowed there. The
 * profit and loss ignores it, so the closed year still reports what it
 * earned. Closing also closes the books through the year end (unless asked
 * not to), so nothing can land in the closed year afterwards and leave its
 * income accounts off zero.
 *
 * Balances are cumulative to the year end, earlier closings included, so a
 * second year's closing moves only that year's profit. A year is reopened by
 * reversing its closing entry, and closed again the same way.
 */

type Tx = Prisma.TransactionClient;

const closeSchema = z.object({
  yearEnd: z
    .string({ error: 'Choose the last day of the financial year.' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the last day of the financial year.'),
  lockBooks: z.enum(['on', 'true', 'false', '']).optional(),
  requestKey: z.string().optional(),
});

const reopenSchema = z.object({
  reason: z.string().trim().min(3, 'Say why the year is being reopened.').max(300),
});

/** Closing entries standing now: booked and not since reversed, newest first. */
async function standingClosings(client: Tx | typeof prisma, organizationId: string) {
  return client.journalEntry.findMany({
    where: {
      organizationId,
      sourceType: 'YEAR_END_CLOSE',
      reversalOfJournalEntryId: null,
      reversals: { none: {} },
    },
    orderBy: { entryDate: 'desc' },
    include: {
      lines: {
        select: {
          chartOfAccountId: true,
          debitAmount: true,
          creditAmount: true,
          chartOfAccount: { select: { role: true } },
        },
      },
      createdBy: { select: { fullName: true } },
    },
  });
}

/** Each income and expense account's balance through a date, in fils (debit positive). */
async function incomeStatementBalances(
  client: Tx | typeof prisma,
  organizationId: string,
  through: Date,
) {
  const [accounts, sums] = await Promise.all([
    client.chartOfAccount.findMany({
      where: { organizationId, accountType: { in: ['REVENUE', 'EXPENSE'] } },
      orderBy: { accountCode: 'asc' },
      select: { id: true, accountCode: true, accountName: true, accountType: true },
    }),
    client.journalEntryLine.groupBy({
      by: ['chartOfAccountId'],
      where: { organizationId, journalEntry: { entryDate: { lte: through } } },
      _sum: { debitAmount: true, creditAmount: true },
    }),
  ]);
  const byAccount = new Map(sums.map((row) => [row.chartOfAccountId, row._sum]));
  return accounts
    .map((account) => {
      const sum = byAccount.get(account.id);
      const net =
        toFils(sum?.debitAmount?.toString() ?? '0') - toFils(sum?.creditAmount?.toString() ?? '0');
      return { ...account, net };
    })
    .filter((account) => account.net !== 0);
}

/** 31 December of the last calendar year that has ended. Any other year end can be chosen. */
function suggestYearEnd() {
  return `${Number(localDateString().slice(0, 4)) - 1}-12-31`;
}

// ─── Reading ────────────────────────────────────────────────────────────────

/** The closings made so far, and what closing through `yearEnd` would move. */
export async function getYearEnd(user: AuthenticatedUser, input: { yearEnd?: string } = {}) {
  requirePermission(user, 'accounting.view');
  const organizationId = user.organizationId;
  const [closings, organization] = await Promise.all([
    standingClosings(prisma, organizationId),
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { booksClosedThrough: true },
    }),
  ]);
  const lastClosed = closings[0]?.entryDate ?? null;
  const yearEnd =
    input.yearEnd && parseCalendarDate(input.yearEnd) ? input.yearEnd : suggestYearEnd();
  const balances = await incomeStatementBalances(
    prisma,
    organizationId,
    parseCalendarDate(yearEnd)!,
  );

  // Profit = income (credit balances) less expenses (debit balances).
  const profitFils = -balances.reduce((sum, account) => sum + account.net, 0);
  const income = balances.filter((a) => a.accountType === 'REVENUE');
  const expenses = balances.filter((a) => a.accountType === 'EXPENSE');

  return {
    yearEnd,
    closedThrough: organization.booksClosedThrough?.toISOString().slice(0, 10) ?? null,
    alreadyClosed: Boolean(lastClosed && lastClosed.toISOString().slice(0, 10) >= yearEnd),
    preview: {
      income: income.map((a) => ({
        id: a.id,
        code: a.accountCode,
        name: a.accountName,
        amount: filsToString(-a.net),
      })),
      expenses: expenses.map((a) => ({
        id: a.id,
        code: a.accountCode,
        name: a.accountName,
        amount: filsToString(a.net),
      })),
      incomeTotal: filsToString(-income.reduce((sum, a) => sum + a.net, 0)),
      expenseTotal: filsToString(expenses.reduce((sum, a) => sum + a.net, 0)),
      profit: filsToString(profitFils),
      profitFils,
    },
    closings: closings.map((entry, index) => {
      // What reached retained earnings: its line's credit (a profit) or debit (a loss).
      const moved = entry.lines
        .filter((line) => line.chartOfAccount.role === 'RETAINED_EARNINGS')
        .reduce(
          (sum, line) =>
            sum + toFils(line.creditAmount.toString()) - toFils(line.debitAmount.toString()),
          0,
        );
      return {
        id: entry.id,
        entryNumber: entry.entryNumber,
        yearEnd: entry.entryDate.toISOString().slice(0, 10),
        closedBy: entry.createdBy.fullName,
        closedAt: entry.createdAt,
        profit: filsToString(moved),
        profitFils: moved,
        /** Only the latest closing can be reopened. */
        canReopen: index === 0,
      };
    }),
  };
}

export type YearEnd = Awaited<ReturnType<typeof getYearEnd>>;

// ─── Closing and reopening ──────────────────────────────────────────────────

/** Closes a financial year into retained earnings. */
export async function closeFinancialYear(user: AuthenticatedUser, rawInput: unknown) {
  requirePermission(user, 'accounting.approve');
  const input = parseInput(closeSchema, rawInput);
  const yearEnd = parseCalendarDate(input.yearEnd);
  if (!yearEnd) throw new DomainError('Choose a valid date.', 'yearEnd');
  if (input.yearEnd >= localDateString()) {
    throw new DomainError('A year can only be closed once it has ended.', 'yearEnd');
  }
  const lock = input.lockBooks === 'on' || input.lockBooks === 'true';

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM organizations WHERE id = ${user.organizationId}::uuid FOR UPDATE`;
    const roles = await ensureChart(tx, user.organizationId);
    const [latest] = await standingClosings(tx, user.organizationId);
    if (latest && latest.entryDate.getTime() >= yearEnd.getTime()) {
      throw new DomainError(
        `The books are already closed for the year ending ${latest.entryDate.toISOString().slice(0, 10)}. Reopen that year first to close an earlier or the same date again.`,
        'yearEnd',
      );
    }

    const balances = await incomeStatementBalances(tx, user.organizationId, yearEnd);
    if (balances.length === 0) {
      throw new DomainError('There is no income or expense to close for that year.', 'yearEnd');
    }
    const lines = balances.map((account) => ({
      accountId: account.id,
      debit: account.net < 0 ? -account.net : 0,
      credit: account.net > 0 ? account.net : 0,
      memo: null as string | null,
    }));
    const profitFils = -balances.reduce((sum, account) => sum + account.net, 0);
    if (profitFils !== 0) {
      lines.push({
        accountId: roles.RETAINED_EARNINGS,
        debit: profitFils < 0 ? -profitFils : 0,
        credit: profitFils > 0 ? profitFils : 0,
        memo: profitFils > 0 ? 'Profit for the year' : 'Loss for the year',
      });
    }

    const entry = await bookEntry(tx, {
      organizationId: user.organizationId,
      branchId: null,
      date: yearEnd,
      description: `Year-end closing — financial year ended ${input.yearEnd}`,
      lines,
      sourceType: 'YEAR_END_CLOSE',
      sourceId: null,
      actorUserId: user.id,
      allowClosedPeriod: true,
    });

    const organization = await tx.organization.findUniqueOrThrow({
      where: { id: user.organizationId },
      select: { booksClosedThrough: true },
    });
    const lockedThrough =
      lock && (!organization.booksClosedThrough || organization.booksClosedThrough < yearEnd)
        ? yearEnd
        : organization.booksClosedThrough;
    if (lockedThrough !== organization.booksClosedThrough) {
      await tx.organization.update({
        where: { id: user.organizationId },
        data: { booksClosedThrough: lockedThrough },
      });
    }
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: 'books.year_closed',
      entityType: 'JournalEntry',
      entityId: entry.id,
      afterData: {
        entryNumber: entry.entryNumber,
        yearEnd: input.yearEnd,
        profit: filsToString(profitFils),
        accounts: balances.length,
        booksClosedThrough: lockedThrough?.toISOString().slice(0, 10) ?? null,
      },
    });
    return { entryNumber: entry.entryNumber, profit: filsToString(profitFils) };
  });
}

/**
 * Reopens a closed year by reversing its closing entry. Only the latest
 * closing can be reversed, so the years always unwind in order. The books'
 * lock is left as it is — reopen the period separately to change the year.
 */
export async function reopenFinancialYear(
  user: AuthenticatedUser,
  entryId: string,
  rawInput: unknown,
) {
  requirePermission(user, 'accounting.approve');
  const input = parseInput(reopenSchema, rawInput);

  return prisma.$transaction(async (tx) => {
    const closings = await standingClosings(tx, user.organizationId);
    const entry = closings.find((closing) => closing.id === entryId);
    if (!entry) throw new NotFoundError('year-end closing');
    if (closings[0].id !== entry.id) {
      throw new DomainError('Reopen the later years first — years are reopened newest first.');
    }
    const reversal = await reverseEntry(tx, entry, entry.entryDate, user.id, input.reason, {
      allowClosedPeriod: true,
    });
    await writeAuditLog(tx, {
      organizationId: user.organizationId,
      actorUserId: user.id,
      action: 'books.year_reopened',
      entityType: 'JournalEntry',
      entityId: entry.id,
      afterData: { reversal: reversal.entryNumber },
      metadata: { reason: input.reason },
    });
    return { entryNumber: reversal.entryNumber };
  });
}
