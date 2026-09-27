'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FileText, Receipt } from 'lucide-react';
import { FormError, TextField, TextareaField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useFormAction } from '@/components/forms/use-form-action';
import { CustomerPicker, type PickedParty } from '@/components/workshop/customer-picker';
import {
  DocumentLinesEditor,
  NO_BILL_DISCOUNT,
  billDiscountPayload,
  linesPayload,
  newEditableLine,
  useLineTotals,
  type BillDiscount,
  type EditableLine,
} from '@/components/workshop/document-lines-editor';
import { formatMoney, localDateString } from '@/lib/format';
import type { ActionResult } from '@/lib/errors';
import type { CustomerOption } from '@/lib/customers/picker';
import { createDirectInvoiceAction } from '../actions';

/*
 * Billing what was done. Either the lines are typed here — in the numbered
 * Parts / Labour list of the workshop's own sheet — or a quotation the
 * customer already approved is carried across as it stands.
 *
 * Every figure shown while typing is produced by the same lib/money rules
 * the server bills with, so the total on screen is the total on the invoice
 * — but the browser's numbers are never trusted: the server prices the lines
 * again from the description, quantity and rate.
 */

export interface QuotationChoice {
  id: string;
  estimateNumber: string;
  totalAmount: string;
  lineCount: number;
  customerId: string;
  customerName: string;
  vehicleId: string | null;
  jobCardId: string | null;
}

export function NewInvoiceForm({
  initialCustomer,
  initialWorkOrder = null,
  quotation,
  defaultVatRate,
}: {
  initialCustomer: CustomerOption | null;
  /** Set when arriving from a job card: it is billed, and moves to Invoiced. */
  initialWorkOrder?: { id: string; vehicleId: string } | null;
  /** Set when arriving from an approved quotation: its lines are billed as quoted. */
  quotation: QuotationChoice | null;
  defaultVatRate: string;
}) {
  const [state, onSubmit, isPending] = useFormAction<ActionResult>(createDirectInvoiceAction, {
    ok: false,
  });
  const [picked, setPicked] = useState<PickedParty | null>(
    initialCustomer
      ? {
          customer: initialCustomer,
          vehicleId:
            quotation?.vehicleId ??
            initialWorkOrder?.vehicleId ??
            (initialCustomer.vehicles.length === 1 ? initialCustomer.vehicles[0].id : ''),
          jobCardId: quotation?.jobCardId ?? initialWorkOrder?.id ?? '',
        }
      : null,
  );
  const [lines, setLines] = useState<EditableLine[]>([newEditableLine('PART', defaultVatRate)]);
  const [bill, setBill] = useState<BillDiscount>(NO_BILL_DISCOUNT);
  const errors = state.fieldErrors ?? {};
  const { totals, incomplete, count } = useLineTotals(lines, defaultVatRate, bill);
  const ready = Boolean(picked) && (quotation !== null || (count > 0 && !incomplete));
  // A quotation is billed exactly as quoted — its own lines and discounts.
  const payload = JSON.stringify(quotation ? [] : linesPayload(lines));
  const discount = quotation ? null : billDiscountPayload(bill);
  const today = localDateString();

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-8">
      <input type="hidden" name="customerId" value={picked?.customer.id ?? ''} />
      <input type="hidden" name="vehicleId" value={picked?.vehicleId ?? ''} />
      <input type="hidden" name="jobCardId" value={picked?.jobCardId ?? ''} />
      <input type="hidden" name="estimateId" value={quotation?.id ?? ''} />
      <input type="hidden" name="items" value={payload} />
      {discount ? (
        <>
          <input type="hidden" name="discountType" value={discount.discountType} />
          <input type="hidden" name="discount" value={discount.discount} />
        </>
      ) : null}

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold tracking-tight">Who is this invoice for?</h2>
        <CustomerPicker
          value={picked}
          onChange={quotation ? () => {} : setPicked}
          autoFocus={!initialCustomer}
        />
      </section>

      {quotation ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold tracking-tight">What is being billed</h2>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-muted/40 p-4">
            <span className="flex min-w-0 items-center gap-3">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">Quotation {quotation.estimateNumber}</span>
                <span className="truncate text-sm text-muted-foreground">
                  {quotation.lineCount} line{quotation.lineCount === 1 ? '' : 's'} ·{' '}
                  {formatMoney(quotation.totalAmount)}
                </span>
              </span>
            </span>
            <Link
              href={`/quotations/${quotation.id}`}
              className="text-sm font-medium text-primary hover:underline"
            >
              View quotation
            </Link>
          </div>
          <p className="text-sm text-muted-foreground">
            The quotation&apos;s lines and VAT are billed exactly as the customer saw them.{' '}
            <Link href="/finance/invoices/new" className="font-medium text-primary hover:underline">
              Type the lines instead
            </Link>
            .
          </p>
        </section>
      ) : (
        <section className="flex flex-col gap-4">
          <h2 className="text-base font-semibold tracking-tight">What are you billing?</h2>
          <DocumentLinesEditor
            lines={lines}
            onChange={setLines}
            bill={bill}
            onBillChange={setBill}
            defaultVatRate={defaultVatRate}
          />
        </section>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <TextField
          label="Due date"
          name="dueDate"
          type="date"
          min={today}
          defaultValue={today}
          error={errors.dueDate}
          hint="Leave as today when the customer pays on collection."
          className="[&_input]:h-11"
        />
        <TextField
          label="Customer's order no. (LPO)"
          name="customerReference"
          error={errors.customerReference}
          hint="Optional — printed on the invoice."
          className="[&_input]:h-11"
        />
      </div>

      <TextareaField
        label="Notes on the invoice"
        name="notes"
        error={errors.notes}
        hint="Optional — shown to the customer."
        className="[&_textarea]:min-h-16"
      />

      <FormError
        message={
          state.error ??
          errors.customerId ??
          errors.vehicleId ??
          errors.jobCardId ??
          errors.items ??
          errors.discount
        }
      />

      <div className="border-t border-border pt-6">
        <SubmitButton
          pending={isPending}
          size="lg"
          disabled={!ready}
          className="h-12 w-full sm:h-11 sm:w-auto"
          pendingLabel="Issuing…"
        >
          <Receipt />
          Issue invoice
          {!quotation && count > 0 && !incomplete ? ` · ${formatMoney(totals.totalAmount)}` : ''}
        </SubmitButton>
        <p className="mt-3 text-sm text-muted-foreground">
          The invoice is issued straight away with its own number. Record the payment on the next
          screen.
        </p>
      </div>
    </form>
  );
}
