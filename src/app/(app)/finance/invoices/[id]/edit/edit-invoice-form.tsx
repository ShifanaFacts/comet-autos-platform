'use client';

import type { TaxCodeOption } from '@/lib/accounting/tax-codes';
import { useState } from 'react';
import Link from 'next/link';
import { Save } from 'lucide-react';
import { FormError, TextField, TextareaField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import {
  DocumentLinesEditor,
  billDiscountPayload,
  linesPayload,
  useLineTotals,
  type BillDiscount,
  type EditableLine,
} from '@/components/workshop/document-lines-editor';
import { formatMoney } from '@/lib/format';
import type { ActionResult } from '@/lib/errors';
import { updateInvoiceAction } from '../../actions';
import type { AccountChoice } from '@/lib/accounting/reports';

export function EditInvoiceForm({
  invoiceId,
  lines: initialLines,
  bill: initialBill,
  issueDate,
  dueDate,
  customerReference,
  notes,
  defaultVatRate,
  incomeAccounts,
  taxCodes,
}: {
  invoiceId: string;
  /** Income accounts a line can book to; omitted, every line uses the default. */
  incomeAccounts?: AccountChoice[];
  lines: EditableLine[];
  bill: BillDiscount;
  /** YYYY-MM-DD; the due date can't be before it. */
  issueDate: string;
  dueDate: string;
  customerReference: string;
  notes: string;
  defaultVatRate: string;
  /** The sales tax codes a line can be given. */
  taxCodes?: TaxCodeOption[];
}) {
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(
    (prev, formData) => updateInvoiceAction(invoiceId, prev, formData),
    { ok: false },
  );
  const [lines, setLines] = useState<EditableLine[]>(initialLines);
  const [bill, setBill] = useState<BillDiscount>(initialBill);
  const { totals, incomplete, count } = useLineTotals(lines, defaultVatRate, bill);
  const errors = state.fieldErrors ?? {};
  const payload = JSON.stringify(linesPayload(lines));
  const discount = billDiscountPayload(bill);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8">
      <input type="hidden" name="items" value={payload} />
      <input type="hidden" name="discountType" value={discount.discountType} />
      <input type="hidden" name="discount" value={discount.discount} />
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold tracking-tight">What is being billed</h2>
        <DocumentLinesEditor
          lines={lines}
          onChange={setLines}
          bill={bill}
          onBillChange={setBill}
          defaultVatRate={defaultVatRate}
          incomeAccounts={incomeAccounts}
          taxCodes={taxCodes}
        />
      </section>

      <div className="grid gap-6 sm:grid-cols-2">
        <TextField
          label="Due date"
          name="dueDate"
          type="date"
          min={issueDate}
          defaultValue={dueDate}
          error={errors.dueDate}
          className="[&_input]:h-11"
        />
        <TextField
          label="Customer's order no. (LPO)"
          name="customerReference"
          defaultValue={customerReference}
          error={errors.customerReference}
          hint="Optional — printed on the invoice."
          className="[&_input]:h-11"
        />
      </div>

      <TextareaField
        label="Notes on the invoice"
        name="notes"
        defaultValue={notes}
        error={errors.notes}
        hint="Optional — shown to the customer."
        className="[&_textarea]:min-h-16"
      />

      <FormError message={state.error ?? errors.items ?? errors.discount} />

      <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center">
        <SubmitButton
          pending={isPending}
          size="lg"
          disabled={count === 0 || incomplete}
          className="h-12 w-full sm:h-11 sm:w-auto"
          pendingLabel="Saving…"
        >
          <Save />
          Save invoice
          {count > 0 && !incomplete ? ` · ${formatMoney(totals.totalAmount)}` : ''}
        </SubmitButton>
        <Link
          href={`/finance/invoices/${invoiceId}`}
          className="inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm font-medium text-muted-foreground hover:bg-muted"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
