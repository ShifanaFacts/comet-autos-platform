import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { filsToString, toFils } from '@/lib/money';
import { parseCalendarDate } from '@/lib/format';
import { resolvePeriod, type ResolvedPeriod } from '@/lib/finance/dashboard';
import type { PeriodInput } from '@/lib/accounting/reports';

/*
 * The statement of cash flows, indirect method (IAS 7), read from the ledger.
 *
 * CASH AND CASH EQUIVALENTS are the accounts money is received into or paid
 * from (cash, bank, card settlements, petty cash). Every other account's
 * movement in the period explains the change in them:
 *
 *   OPERATING   net profit, with depreciation added back and any gain on
 *               disposal taken out (its proceeds are investing), then the
 *               change in working capital: receivables, inventory, VAT,
 *               prepayments, payables, accruals, salaries owed.
 *   INVESTING   fixed assets bought and sold (the register's asset and
 *               accumulated-depreciation accounts, and anything coded
 *               1500–1599).
 *   FINANCING   the owner's capital and drawings, loans and the owner's
 *               current account (liabilities coded 2510–2599).
 *
 * Opening balances are not a cash flow: the cash they bring in is part of
 * the cash at the start, and year-end closing entries move no cash at all.
 * Both are left out of the flows.
 *
 * Because every entry balances, the three sections always add up to the
 * change in cash. The statement shows that check rather than assuming it.
 */

type Section = 'OPERATING' | 'INVESTING' | 'FINANCING';

interface FlowRow {
  key: string;
  label: string;
  fils: number;
  amount: string;
}

const DAY = 86_400_000;

export async function getCashFlowStatement(user: AuthenticatedUser, input: PeriodInput = {}) {
  requirePermission(user, 'reports.view');
  const organizationId = user.organizationId;
  const period: ResolvedPeriod = resolvePeriod(input);
  const from = parseCalendarDate(period.from)!;
  const to = parseCalendarDate(period.to)!;
  const beforeStart = new Date(from.getTime() - DAY);

  const [accounts, assets, lines, openingCash] = await Promise.all([
    prisma.chartOfAccount.findMany({
      where: { organizationId },
      select: {
        id: true,
        accountCode: true,
        accountName: true,
        accountType: true,
        role: true,
        isPaymentAccount: true,
      },
    }),
    prisma.fixedAsset.findMany({
      where: { organizationId },
      select: { assetAccountId: true, accumulatedAccountId: true },
    }),
    prisma.journalEntryLine.findMany({
      where: { organizationId, journalEntry: { entryDate: { gte: from, lte: to } } },
      select: {
        chartOfAccountId: true,
        debitAmount: true,
        creditAmount: true,
        journalEntry: { select: { id: true, sourceType: true } },
      },
    }),
    prisma.journalEntryLine.groupBy({
      by: ['chartOfAccountId'],
      where: {
        organizationId,
        chartOfAccount: { isPaymentAccount: true },
        journalEntry: { entryDate: { lte: beforeStart } },
      },
      _sum: { debitAmount: true, creditAmount: true },
    }),
  ]);

  const account = new Map(accounts.map((a) => [a.id, a]));
  const assetAccounts = new Set(assets.map((a) => a.assetAccountId));
  const accumulatedAccounts = new Set(assets.map((a) => a.accumulatedAccountId));
  const openingEquity = accounts.find((a) => a.role === 'OPENING_BALANCE')?.id;

  // Entries that bring opening balances in: anything touching opening balance equity.
  const openingEntries = new Set(
    lines
      .filter((line) => line.chartOfAccountId === openingEquity)
      .map((line) => line.journalEntry.id),
  );

  const net = (line: {
    debitAmount: { toString(): string };
    creditAmount: { toString(): string };
  }) => toFils(line.debitAmount.toString()) - toFils(line.creditAmount.toString());

  let cashBroughtIn = 0;
  let cashMovement = 0;
  let profit = 0;
  let depreciation = 0;
  let disposalGain = 0;
  const bySection = new Map<
    string,
    { section: Section; label: string; fils: number; type?: string }
  >();
  const add = (section: Section, key: string, label: string, fils: number, type?: string) => {
    const row = bySection.get(key) ?? { section, label, fils: 0, type };
    row.fils += fils;
    bySection.set(key, row);
  };

  for (const line of lines) {
    const acct = account.get(line.chartOfAccountId);
    if (!acct) continue;
    const debit = net(line);
    const source = line.journalEntry.sourceType;
    if (source === 'YEAR_END_CLOSE') continue;
    if (openingEntries.has(line.journalEntry.id)) {
      if (acct.isPaymentAccount) cashBroughtIn += debit;
      continue;
    }
    if (acct.isPaymentAccount) {
      cashMovement += debit;
      continue;
    }
    // A credit to an asset or a debit to a liability — seen from the cash side,
    // every non-cash movement is its negative.
    const cash = -debit;
    if (acct.accountType === 'REVENUE' || acct.accountType === 'EXPENSE') {
      profit += cash;
      if (acct.role === 'ASSET_DISPOSALS') disposalGain += cash;
      continue;
    }
    if (accumulatedAccounts.has(acct.id) && source === 'DEPRECIATION') {
      depreciation += cash;
      continue;
    }
    const code = acct.accountCode;
    if (
      acct.accountType === 'ASSET' &&
      (assetAccounts.has(acct.id) || accumulatedAccounts.has(acct.id) || /^15\d\d$/.test(code))
    ) {
      add('INVESTING', 'fixed-assets', 'Property, plant & equipment', cash);
      continue;
    }
    if (
      acct.accountType === 'EQUITY' ||
      (acct.accountType === 'LIABILITY' && /^25\d\d$/.test(code) && code !== '2500')
    ) {
      add('FINANCING', acct.id, acct.accountName, cash);
      continue;
    }
    add('OPERATING', acct.id, acct.accountName, cash, acct.accountType);
  }

  // The gain on a disposal is part of what the asset sold for: investing, not operating.
  if (disposalGain !== 0)
    add('INVESTING', 'fixed-assets', 'Property, plant & equipment', disposalGain);

  const rows = (section: Section): FlowRow[] =>
    [...bySection.entries()]
      .filter(([, row]) => row.section === section && row.fils !== 0)
      .map(([key, row]) => ({
        key,
        // Working capital reads by its net direction for the period.
        label: row.type ? workingCapitalLabel(row.type, row.label, row.fils) : row.label,
        fils: row.fils,
        amount: filsToString(row.fils),
      }))
      .sort((a, b) => Math.abs(b.fils) - Math.abs(a.fils));

  const workingCapital = rows('OPERATING');
  const investing = rows('INVESTING').map((row) =>
    row.key === 'fixed-assets'
      ? {
          ...row,
          label: row.fils < 0 ? 'Purchase of fixed assets' : 'Proceeds from fixed assets sold',
        }
      : row,
  );
  const financing = rows('FINANCING');
  const sum = (items: { fils: number }[]) => items.reduce((total, row) => total + row.fils, 0);

  const operatingFils = profit + depreciation - disposalGain + sum(workingCapital);
  const investingFils = sum(investing);
  const financingFils = sum(financing);
  const netChange = operatingFils + investingFils + financingFils;

  const openingFils =
    openingCash.reduce(
      (total, row) =>
        total +
        toFils(row._sum.debitAmount?.toString() ?? '0') -
        toFils(row._sum.creditAmount?.toString() ?? '0'),
      0,
    ) + cashBroughtIn;
  const closingFils = openingFils + cashMovement;

  return {
    period,
    operating: {
      profit: filsToString(profit),
      depreciation: filsToString(depreciation),
      disposalGain: filsToString(disposalGain),
      workingCapital,
      total: filsToString(operatingFils),
    },
    investing: { rows: investing, total: filsToString(investingFils) },
    financing: { rows: financing, total: filsToString(financingFils) },
    netChange: filsToString(netChange),
    netChangeFils: netChange,
    opening: filsToString(openingFils),
    broughtIn: filsToString(cashBroughtIn),
    closing: filsToString(closingFils),
    /** Should always be zero: the flows explain every movement in cash. */
    difference: filsToString(closingFils - openingFils - netChange),
    reconciles: closingFils - openingFils === netChange,
  };
}

export type CashFlowStatement = Awaited<ReturnType<typeof getCashFlowStatement>>;

/** "(Increase) / decrease in trade receivables", worded the way a statement reads. */
function workingCapitalLabel(type: string, name: string, cash: number) {
  const lower = name.charAt(0).toLowerCase() + name.slice(1);
  if (type === 'ASSET') return `${cash < 0 ? 'Increase' : 'Decrease'} in ${lower}`;
  return `${cash > 0 ? 'Increase' : 'Decrease'} in ${lower}`;
}
