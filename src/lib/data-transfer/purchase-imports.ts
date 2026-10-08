import { DomainError } from '@/lib/errors';
import { createPart } from '@/lib/inventory/parts';
import { LIKELY_SAME, similarParts } from '@/lib/inventory/part-match';
import { createSupplier } from '@/lib/inventory/suppliers';
import { createPurchaseInTransaction } from '@/lib/inventory/purchases';
import { field } from '@/lib/data-transfer/csv';
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
 * Supplier bills from a spreadsheet — typed up, or converted from a photo of
 * the bill. One row per line of a bill; rows with the same supplier and
 * supplier invoice number are one purchase, and the bill's own details (its
 * date, discount, round-off and payment) are read from whichever of its rows
 * has them, normally the first.
 *
 * Each purchase goes through the very same function as "Save & receive
 * stock" on the purchase form — priced, checked for a duplicate bill,
 * received into stock, booked and, when an amount paid is given, paid — so
 * an imported bill follows exactly the form's rules. A supplier or part not
 * on file yet is added from the row (a part without a code gets the next
 * P- code). A bill already entered is skipped, not duplicated.
 */

interface Bill {
  supplier: string;
  invoice: string;
  rows: { index: number; record: Record<string, string> }[];
}

/** A bill-level value: from whichever of its rows has it — normally the first. */
function header(bill: Bill, ...names: string[]) {
  for (const { record } of bill.rows) {
    const value = field(record, ...names);
    if (value) return value;
  }
  return '';
}

/** An amount as typed — "1,234.50", "AED 60" — or blank. */
const amount = (value: string) => readAmount(value);

export const PURCHASE_IMPORTS: Record<string, ImportDefinition> = {
  purchases: {
    label: 'Purchases',
    noun: 'purchase',
    permission: 'purchase.create',
    note: 'One row per line of a supplier bill. Rows with the same Supplier and Supplier invoice no. are one purchase; the bill’s date, discount, round-off and payment can sit on its first row. Each purchase is received into stock as it is imported. A supplier or part not on file yet is added from the row; a bill already entered is skipped.',
    columns: [
      { header: 'Supplier', required: true, example: 'Taimoor Auto Spare Parts' },
      { header: 'Supplier TRN', example: '104558747200001', hint: 'Used when the supplier is new' },
      { header: 'Supplier invoice no.', required: true, example: '38039' },
      { header: 'Date', required: true, example: '26/09/2026', hint: 'DD/MM/YYYY or YYYY-MM-DD' },
      { header: 'Due date', example: '', hint: 'Optional: when the supplier expects payment' },
      { header: 'Part code', example: '', hint: 'The item code; blank to match the part by name' },
      { header: 'Part name', required: true, example: 'OIL 5W40-4LTR LEXUS NEW' },
      { header: 'Quantity', required: true, example: '1' },
      { header: 'Unit cost', required: true, example: '60.00', hint: 'Before VAT' },
      { header: 'VAT %', example: '5', hint: 'Blank for the standard rate' },
      { header: 'Line discount', example: '', hint: 'AED off this line, before VAT' },
      { header: 'Bill discount', example: '', hint: 'AED off the whole bill, before VAT' },
      { header: 'Round-off', example: '', hint: 'The bill’s adjusted amount, e.g. -0.20' },
      { header: 'Amount paid', example: '99.75', hint: 'Blank means pay later' },
      {
        header: 'Payment method',
        example: 'Cash',
        hint: 'Cash, Card, Bank transfer, Cheque or Online',
      },
      {
        header: 'Paid from',
        example: '1000',
        hint: 'Account code: 1000 cash on hand, 1005 petty cash, 1010 bank',
      },
      { header: 'Notes', example: '' },
    ],
    secondExample: {
      Supplier: 'Taimoor Auto Spare Parts',
      'Supplier invoice no.': '38039',
      'Part name': 'ENG OIL 5W40-1LTR LX NEW',
      Quantity: '1',
      'Unit cost': '20.00',
      'VAT %': '5',
    },
    async run(tx, user, records, outcome) {
      // Group the rows into bills: same supplier, same invoice number.
      const bills: Bill[] = [];
      const byKey = new Map<string, Bill>();
      records.forEach((record, index) => {
        const supplier = field(record, 'Supplier', 'Supplier name').trim();
        const invoice = field(record, 'Supplier invoice no.', 'Invoice no.', 'Bill no.').trim();
        const key =
          supplier && invoice
            ? `${supplier.toLowerCase()}|${invoice.toUpperCase()}`
            : `\u0000${index}`;
        let bill = byKey.get(key);
        if (!bill) {
          bill = { supplier, invoice, rows: [] };
          byKey.set(key, bill);
          bills.push(bill);
        }
        bill.rows.push({ index, record });
      });

      const [suppliers, parts, accounts, entered] = await Promise.all([
        tx.supplier.findMany({
          where: { organizationId: user.organizationId, isActive: true },
          select: { id: true, name: true, taxNumber: true },
        }),
        tx.part.findMany({
          where: { organizationId: user.organizationId, isActive: true },
          select: { id: true, sku: true, name: true },
        }),
        tx.chartOfAccount.findMany({
          where: { organizationId: user.organizationId, isPaymentAccount: true, isActive: true },
          select: { id: true, accountCode: true, accountName: true },
        }),
        tx.purchase.findMany({
          where: {
            organizationId: user.organizationId,
            status: { not: 'CANCELLED' },
            supplierInvoiceNumber: { not: null },
          },
          select: { supplierId: true, supplierInvoiceNumber: true, purchaseNumber: true },
        }),
      ]);
      const supplierByName = new Map(suppliers.map((s) => [s.name.trim().toLowerCase(), s.id]));
      // The TRN is the supplier's identity: two spellings of one name are one supplier.
      const digits = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '');
      const supplierByTrn = new Map(
        suppliers
          .filter((s) => digits(s.taxNumber).length === 15)
          .map((s) => [digits(s.taxNumber), s.id]),
      );
      const partByCode = new Map(parts.map((p) => [p.sku.trim().toUpperCase(), p.id]));
      // A name matches only when exactly one part has it.
      const partByName = new Map<string, string | null>();
      for (const part of parts) {
        const key = part.name.trim().toLowerCase();
        partByName.set(key, partByName.has(key) ? null : part.id);
      }
      const known = parts.map((part) => ({ id: part.id, name: part.name, sku: part.sku }));
      const accountByCode = new Map(
        accounts.flatMap((a) => [
          [a.accountCode.trim().toLowerCase(), a.id],
          [a.accountName.trim().toLowerCase(), a.id],
        ]),
      );
      const alreadyEntered = new Map(
        entered.map((p) => [
          `${p.supplierId}|${p.supplierInvoiceNumber!.toUpperCase()}`,
          p.purchaseNumber,
        ]),
      );

      for (const bill of bills) {
        const first = bill.rows[0].index;
        try {
          if (!bill.supplier) throw new DomainError('Every row needs its Supplier.');
          if (!bill.invoice) throw new DomainError('Every row needs its Supplier invoice no.');

          // The supplier: on file, or added from the row.
          const trn = digits(header(bill, 'Supplier TRN', 'TRN'));
          let supplierId =
            (trn.length === 15 ? supplierByTrn.get(trn) : undefined) ??
            supplierByName.get(bill.supplier.toLowerCase());
          if (supplierId) {
            const number = alreadyEntered.get(`${supplierId}|${bill.invoice.toUpperCase()}`);
            if (number) {
              outcome.skipped.push({
                row: rowNumber(first),
                reason: `${bill.supplier} invoice ${bill.invoice} is already entered as ${number}`,
              });
              continue;
            }
          } else {
            const created = await createSupplier(
              user,
              { name: bill.supplier, taxNumber: header(bill, 'Supplier TRN', 'TRN') },
              tx,
            );
            supplierId = created.id;
            supplierByName.set(bill.supplier.toLowerCase(), supplierId);
            if (trn.length === 15) supplierByTrn.set(trn, supplierId);
          }

          const dateText = header(bill, 'Date', 'Invoice date', 'Bill date');
          if (!dateText) throw new DomainError('Every bill needs its Date.');
          const date = readImportDate(dateText, 'Date')!.toISOString().slice(0, 10);
          const dueText = header(bill, 'Due date');
          const due = dueText
            ? readImportDate(dueText, 'Due date')!.toISOString().slice(0, 10)
            : '';

          // The lines: each part on file by its code or name, or added from the row.
          const items = [];
          for (const { index, record } of bill.rows) {
            const code = field(record, 'Part code', 'Item code', 'SKU').trim();
            const name = field(record, 'Part name', 'Description', 'Part').trim();
            if (!name && !code) {
              throw new DomainError(`Row ${rowNumber(index)}: give the Part name or Part code.`);
            }
            const unitCost = amount(field(record, 'Unit cost', 'Unit price', 'Price'));
            const taxRate = amount(field(record, 'VAT %', 'VAT'));
            let partId =
              (code && partByCode.get(code.toUpperCase())) ||
              (!code && name ? partByName.get(name.toLowerCase()) : undefined) ||
              undefined;
            // The same part under another spelling ("Brake pads" for "Brake pad")
            // is used, not added twice — when exactly one part is that close.
            if (!partId && name && !code) {
              const close = similarParts({ name }, known, { threshold: LIKELY_SAME, limit: 2 });
              if (close.length === 1) partId = close[0].part.id;
            }
            if (!partId) {
              const created = await createPart(
                user,
                {
                  sku: code,
                  name: name || code,
                  unitOfMeasure: 'piece',
                  costPrice: unitCost,
                  taxRate,
                },
                tx,
              );
              partId = created.id;
              partByCode.set(created.sku.trim().toUpperCase(), partId);
              if (name) partByName.set(name.toLowerCase(), partId);
              known.push({ id: created.id, name: created.name, sku: created.sku });
            }
            const lineDiscount = amount(field(record, 'Line discount', 'Discount'));
            items.push({
              partId,
              quantity: field(record, 'Quantity', 'Qty').trim(),
              unitCost,
              taxRate,
              discountType: lineDiscount && !/^0*\.?0*$/.test(lineDiscount) ? 'AMOUNT' : '',
              discountValue: lineDiscount && !/^0*\.?0*$/.test(lineDiscount) ? lineDiscount : '',
            });
          }

          // The bill's own figures and its payment.
          const billDiscount = amount(header(bill, 'Bill discount'));
          const paid = amount(header(bill, 'Amount paid', 'Paid'));
          const payNow = paid !== '' && !/^0*\.?0*$/.test(paid);
          const paidFrom = header(bill, 'Paid from', 'Account').trim();
          const accountId = paidFrom ? lookupAccount(accountByCode, paidFrom) : '';
          if (paidFrom && !accountId) {
            throw new DomainError(
              `Paid from "${paidFrom}" is not a cash, bank or card account code — e.g. 1000, 1005 or 1010.`,
            );
          }

          await createPurchaseInTransaction(
            tx,
            user,
            {
              supplierId,
              supplierInvoiceNumber: bill.invoice,
              supplierInvoiceDate: date,
              dueDate: due,
              notes: header(bill, 'Notes'),
              items,
              billDiscountType: billDiscount && !/^0*\.?0*$/.test(billDiscount) ? 'AMOUNT' : '',
              billDiscountValue:
                billDiscount && !/^0*\.?0*$/.test(billDiscount) ? billDiscount : '',
              roundingAdjustment: header(bill, 'Round-off', 'Rounding', 'Adjustment').replace(
                /,/g,
                '',
              ),
              payment: payNow ? 'now' : 'later',
              ...(payNow
                ? {
                    payAmount: paid,
                    method: readPaymentMethod(header(bill, 'Payment method', 'Method')),
                    accountId: accountId ?? '',
                    payReference: bill.invoice,
                  }
                : {}),
            },
            { receive: true },
          );
          alreadyEntered.set(`${supplierId}|${bill.invoice.toUpperCase()}`, bill.invoice);
          outcome.created += 1;
        } catch (error) {
          fail(outcome, first, error);
        }
      }
    },
  },
};
