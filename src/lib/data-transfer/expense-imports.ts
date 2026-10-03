import { DomainError } from '@/lib/errors';
import { filsToString, toFils } from '@/lib/money';
import { recordExpenseInTransaction } from '@/lib/finance/expenses';
import { field, fieldStarting } from '@/lib/data-transfer/csv';
import {
  fail,
  lookupAccount,
  rowNumber,
  type ImportDefinition,
} from '@/lib/data-transfer/import-rows';
import {
  readAmount,
  readImportDate,
  readPaymentMethod,
} from '@/lib/data-transfer/document-imports';

/*
 * Expenses and bills from a spreadsheet — typed up, or converted from photos
 * of the receipts. One row per expense. Each goes through the very same
 * function as the expense form, so it is checked, VAT-split, booked and (when
 * paid) paid from its account exactly as if it had been typed.
 *
 * A bill usually shows its total with VAT, so either the amount before VAT or
 * the total can be given; with the VAT as printed on the bill, that is what
 * is reclaimed. An expense already entered (same vendor and bill number) is
 * skipped, not duplicated.
 */

const blank = (value: string) => value === '' || /^0*\.?0*$/.test(value);

export const EXPENSE_IMPORTS: Record<string, ImportDefinition> = {
  expenses: {
    label: 'Expenses',
    noun: 'expense',
    permission: 'expense.create',
    note: 'One row per expense. Give the Amount before VAT, or the Total with VAT — with the VAT amount as printed on the bill when there is one. Leave Payment method and Paid from blank for a bill not paid yet. An expense already entered (same Vendor and Bill no.) is skipped.',
    columns: [
      { header: 'Date', required: true, example: '01/10/2026', hint: 'DD/MM/YYYY or YYYY-MM-DD' },
      { header: 'Description', required: true, example: 'Printer repair (both heads replaced)' },
      {
        header: 'Category',
        example: '5150',
        hint: 'Expense account code or name, e.g. 5150 or Repairs & maintenance',
      },
      { header: 'Amount', example: '', hint: 'Before VAT — or leave blank and give Total' },
      { header: 'VAT %', example: '', hint: 'Blank or 0 for no VAT' },
      { header: 'VAT amount', example: '', hint: 'As printed on the bill' },
      { header: 'Total', example: '200.00', hint: 'With VAT' },
      { header: 'Vendor', example: 'Al Qusais Printer Services' },
      { header: 'Vendor TRN', example: '', hint: '15 digits, when the bill shows one' },
      { header: 'Bill no.', example: '' },
      { header: 'Due date', example: '', hint: 'For a bill not paid yet' },
      {
        header: 'Payment method',
        example: 'Cash',
        hint: 'Cash, Card, Bank transfer, Cheque or Online — blank if not paid yet',
      },
      {
        header: 'Paid from',
        example: '1005',
        hint: 'Account code: 1000 cash on hand, 1005 petty cash, 1010 bank',
      },
      { header: 'Reference', example: '', hint: 'Transfer, cheque or card-slip number' },
      { header: 'Notes', example: '' },
    ],
    secondExample: {
      Date: '01/10/2026',
      Description: 'Parts delivery',
      Category: '5140',
      Total: '10.00',
      'Payment method': 'Cash',
      'Paid from': '1005',
    },
    async run(tx, user, records, outcome) {
      const [categories, moneyAccounts, entered] = await Promise.all([
        tx.chartOfAccount.findMany({
          where: { organizationId: user.organizationId, accountType: 'EXPENSE', isActive: true },
          select: { id: true, accountCode: true, accountName: true },
        }),
        tx.chartOfAccount.findMany({
          where: { organizationId: user.organizationId, isPaymentAccount: true, isActive: true },
          select: { id: true, accountCode: true, accountName: true },
        }),
        tx.expense.findMany({
          where: {
            organizationId: user.organizationId,
            status: 'RECORDED',
            billNumber: { not: null },
          },
          select: { vendorName: true, billNumber: true, expenseNumber: true },
        }),
      ]);
      const categoryBy = new Map<string, string>();
      for (const account of categories) {
        categoryBy.set(account.accountCode.trim().toLowerCase(), account.id);
        categoryBy.set(account.accountName.trim().toLowerCase(), account.id);
      }
      const accountByCode = new Map(
        moneyAccounts.flatMap((a) => [
          [a.accountCode.trim().toLowerCase(), a.id],
          [a.accountName.trim().toLowerCase(), a.id],
        ]),
      );
      const key = (vendor: string, bill: string) =>
        `${vendor.trim().toLowerCase()}|${bill.trim().toUpperCase()}`;
      const alreadyEntered = new Map(
        entered.map((e) => [
          key(e.vendorName ?? '', e.billNumber!),
          e.expenseNumber ?? 'an expense',
        ]),
      );

      // A supplier-bill file (one row per part) belongs on Purchases → Import.
      const first = records[0] ?? {};
      if (!('description' in first) && ('partname' in first || 'supplierinvoiceno' in first)) {
        outcome.errors.push({
          row: rowNumber(0),
          message:
            'This is a purchases file (supplier bills with parts) — import it on Inventory → Purchases → Import, not here.',
        });
        return;
      }

      for (const [index, record] of records.entries()) {
        try {
          const vendor = field(record, 'Vendor', 'Supplier', 'Paid to').trim();
          const bill = field(record, 'Bill no.', 'Bill number', 'Invoice no.').trim();
          if (bill) {
            const existing = alreadyEntered.get(key(vendor, bill));
            if (existing) {
              outcome.skipped.push({
                row: rowNumber(index),
                reason: `${vendor || 'Bill'} ${bill} is already entered as ${existing}`,
              });
              continue;
            }
          }

          const dateText = field(record, 'Date', 'Expense date').trim();
          if (!dateText) throw new DomainError('Every expense needs its Date.');
          const date = readImportDate(dateText, 'Date')!.toISOString().slice(0, 10);
          const dueText = field(record, 'Due date').trim();
          const due = dueText
            ? readImportDate(dueText, 'Due date')!.toISOString().slice(0, 10)
            : '';

          const categoryText = field(record, 'Category', 'Account').trim();
          const categoryId = categoryText ? lookupAccount(categoryBy, categoryText) : '';
          if (categoryText && !categoryId) {
            throw new DomainError(
              `Category "${categoryText}" is not an expense account — use its code (e.g. 5150) or its name as in the chart of accounts.`,
            );
          }

          // The figures: before VAT, or the total with VAT and (as printed) the VAT.
          // Headings matched as typed, then by how they start ("Total (AED)",
          // "VAT amount (AED)", "Amount before VAT") — files often add a unit.
          // "VAT %" and "VAT" read alike, so the VAT amount never falls back to "VAT".
          const rateText = readAmount(
            field(record, 'VAT %', 'VAT rate') ||
              fieldStarting(record, ['vatrate', 'vatpercent', 'taxrate']),
          );
          const rate = blank(rateText) ? '' : rateText;
          const vatText = readAmount(
            field(record, 'VAT amount', 'Tax amount') ||
              fieldStarting(record, ['vatamount', 'taxamount', 'totalvat', 'vataed']),
          );
          const amountText = readAmount(
            field(record, 'Amount', 'Net', 'Amount before VAT') ||
              fieldStarting(record, [
                'amountbefore',
                'amountexcl',
                'netamount',
                'subtotal',
                'taxable',
              ]),
          );
          const totalText = readAmount(
            field(record, 'Total', 'Total amount', 'Amount with VAT') ||
              fieldStarting(
                record,
                ['total', 'grandtotal', 'amountincl', 'amountwith', 'amountpaid'],
                ['totalvat', 'totaltax', 'totalquantity'],
              ),
          );
          let amount = amountText;
          let taxAmount = blank(vatText) ? '' : vatText;
          if (!amount) {
            if (!totalText) {
              throw new DomainError(
                `Give the Amount (before VAT) or the Total. This row has: ${
                  Object.entries(record)
                    .filter(([, value]) => value !== '')
                    .map(([name]) => name)
                    .join(', ') || 'nothing'
                }.`,
              );
            }
            const total = toFils(totalText, 'Total');
            if (taxAmount) {
              amount = filsToString(total - toFils(taxAmount, 'VAT amount'));
            } else if (rate) {
              // VAT included in the total: the share at the rate, half-up to the fil.
              const hundredths = Math.round(Number(rate) * 100);
              const net = Math.round((total * 10000) / (10000 + hundredths));
              amount = filsToString(net);
              taxAmount = filsToString(total - net);
            } else {
              amount = filsToString(total);
            }
          }
          if (taxAmount && !rate) {
            throw new DomainError('A VAT amount needs its VAT % (usually 5).');
          }

          const methodText = field(record, 'Payment method', 'Method').trim();
          const paidFrom = field(record, 'Paid from', 'Account paid from').trim();
          const paid = Boolean(methodText || paidFrom);
          const paidFromAccountId = paidFrom ? lookupAccount(accountByCode, paidFrom) : '';
          if (paidFrom && !paidFromAccountId) {
            throw new DomainError(
              `Paid from "${paidFrom}" is not a cash, bank or card account code — e.g. 1000, 1005 or 1010.`,
            );
          }

          await recordExpenseInTransaction(tx, user, {
            description: field(record, 'Description', 'Details', 'For').trim(),
            amount,
            taxRate: rate,
            taxAmount,
            expenseDate: date,
            vendorName: vendor,
            billNumber: bill,
            supplierTrn: field(record, 'Vendor TRN', 'Supplier TRN', 'TRN').trim(),
            dueDate: paid ? '' : due,
            paymentReference: field(record, 'Reference', 'Payment reference').trim(),
            notes: field(record, 'Notes').trim(),
            paymentMethod: paid ? readPaymentMethod(methodText) : '',
            paidFromAccountId: paidFromAccountId ?? '',
            categoryId: categoryId ?? '',
          });
          if (bill) alreadyEntered.set(key(vendor, bill), bill);
          outcome.created += 1;
        } catch (error) {
          fail(outcome, index, error);
        }
      }
    },
  },
};
