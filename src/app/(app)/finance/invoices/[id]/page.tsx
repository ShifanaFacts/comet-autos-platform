import Link from 'next/link';
import { getPaymentModeOptions } from '@/lib/accounting/payment-modes';
import { notFound } from 'next/navigation';
import { ArrowRight, Ban, Car, ClipboardList, FileMinus, Info, Pencil, User } from 'lucide-react';
import { hasPermission, requireUser } from '@/lib/auth/authorize';
import { canSeeJobProfit, getJobCost } from '@/lib/finance/job-costing';
import { JobCostPanel } from '@/components/finance/job-cost-panel';
import { NotFoundError } from '@/lib/errors';
import { getInvoiceDetail } from '@/lib/billing/invoice';
import { invoiceEditBlocker, invoiceVoidBlocker, isCredited } from '@/lib/billing/invoice-changes';
import { creditBlocker, listInvoiceCreditNotes } from '@/lib/billing/credit-notes';
import { getInvoiceAdvances } from '@/lib/billing/advances';
import { billDiscountBreakdown, filsToString, toFils } from '@/lib/money';
import {
  formatCalendarDate,
  formatDateTime,
  formatMoney,
  localDateString,
  toLocalDateTimeInput,
} from '@/lib/format';
import { PAYMENT_METHOD_LABEL } from '@/lib/documents/build';
import { Grid, PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { StatusPill } from '@/components/shared/status-pill';
import { VehiclePlate } from '@/components/shared/vehicle-plate';
import { DocumentLinesView } from '@/components/workshop/estimate-lines';
import { getAccountChoices } from '@/lib/accounting/reports';
import { StaffDocumentActions } from '@/components/documents/document-actions';
import { InvoicePaymentForm } from '@/components/finance/invoice-payment-form';
import { ReversePaymentButton, VoidInvoiceButton } from '@/components/finance/invoice-corrections';
import { ShortPaymentButton } from '@/components/finance/short-payment';
import { ApplyAdvanceForm, UndoApplicationButton } from '@/components/finance/advance-forms';

/*
 * One invoice: what was billed, what has been paid, and the receipt for each
 * payment. The job card, when there is one, is a link beside the customer
 * rather than the thing the page is about.
 */

const STATE_TONE = {
  UNPAID: 'warning',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
} as const;

const STATE_LABEL = {
  UNPAID: 'Unpaid',
  PARTIALLY_PAID: 'Partly paid',
  PAID: 'Paid',
} as const;

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  let invoice;
  try {
    invoice = await getInvoiceDetail(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const { customer, vehicle, jobCard } = invoice;
  const branch = { branchId: invoice.branchId };
  // What the job cost and made — for those who see the books.
  const jobCost = canSeeJobProfit(user) ? await getJobCost(user, invoice.id) : null;
  const isVoid = invoice.status === 'VOID';
  const canPay = !isVoid && hasPermission(user, 'payment.create', branch);
  const editBlocker = invoiceEditBlocker(invoice);
  const canEditInvoice = hasPermission(user, 'invoice.edit', branch) && !editBlocker;
  const canVoid = hasPermission(user, 'invoice.delete', branch) && !invoiceVoidBlocker(invoice);
  const canReverse = !isVoid && hasPermission(user, 'payment.delete', branch);
  // Paid, but the customer really handed over a little less than recorded.
  const canSettleShort =
    invoice.status === 'PAID' &&
    !isCredited(invoice) &&
    hasPermission(user, 'invoice.edit', branch) &&
    hasPermission(user, 'payment.delete', branch) &&
    hasPermission(user, 'payment.create', branch);
  const canCredit = hasPermission(user, 'credit_note.create', branch) && !creditBlocker(invoice);
  // Only the notes that stand: a voided one counts for nothing and is kept
  // on record under Credit notes → Void, not on the invoice.
  const creditNotes = (await listInvoiceCreditNotes(user, invoice.id)).filter(
    (note) => note.status !== 'VOID',
  );
  const credited = toFils(invoice.creditedAmount.toString());
  const advanceApplied = toFils(invoice.advanceApplied);
  const discountAfter = toFils(invoice.settlementDiscount.toString());
  // A discount on the bill, shown as the customer reads it on the invoice.
  const breakdown = billDiscountBreakdown(invoice);
  const discountRows = breakdown
    ? [
        { label: 'Subtotal', amount: breakdown.linesTotal },
        { label: 'VAT before discount', amount: breakdown.vatBefore },
        { label: 'Price before discount', amount: breakdown.totalBefore },
        {
          label: 'Discount (' + breakdown.discount + ' + VAT ' + breakdown.vatSaved + ')',
          amount: filsToString(-toFils(breakdown.discountWithVat)),
        },
      ]
    : [];
  const advances = await getInvoiceAdvances(user, { id: invoice.id, customerId: customer.id });
  const canApplyAdvance =
    !isVoid &&
    advances !== null &&
    advances.canApply &&
    advances.available.length > 0 &&
    invoice.invoiceType !== 'PROFORMA' &&
    (invoice.status === 'ISSUED' || invoice.status === 'PARTIALLY_PAID') &&
    toFils(invoice.balanceDue) > 0;
  const fullyCredited = credited > 0 && credited >= toFils(invoice.totalAmount.toString());
  // A reversed payment, and the payment it reversed, are not receipts.
  const reversals = new Map(
    invoice.payments
      .filter((payment) => payment.reversalOfPaymentId)
      .map((payment) => [payment.reversalOfPaymentId!, payment]),
  );
  const receipts = invoice.payments.filter(
    (payment) =>
      payment.status === 'COMPLETED' && !payment.reversalOfPaymentId && !reversals.has(payment.id),
  );
  const reversedPayments = invoice.payments.filter((payment) => reversals.has(payment.id));

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            Invoice
            {jobCard ? (
              <>
                <span aria-hidden>·</span>
                <Link href={`/job-cards/${jobCard.id}`} className="text-primary hover:underline">
                  {jobCard.jobNumber}
                </Link>
              </>
            ) : null}
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {invoice.invoiceNumber}
            {isVoid ? (
              <StatusPill tone="danger">Void</StatusPill>
            ) : fullyCredited ? (
              <StatusPill tone="neutral">Credited in full</StatusPill>
            ) : (
              <StatusPill tone={STATE_TONE[invoice.paymentState]}>
                {STATE_LABEL[invoice.paymentState]}
              </StatusPill>
            )}
          </span>
        }
        description={[
          `For ${customer.name}`,
          `issued ${formatCalendarDate(invoice.issueDate)}`,
          // Due on receipt needs no mention; a later date does.
          invoice.dueDate && invoice.dueDate > invoice.issueDate
            ? `due ${formatCalendarDate(invoice.dueDate)}`
            : null,
          invoice.customerReference ? `order no. ${invoice.customerReference}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        leading={vehicle ? <VehiclePlate plateNumber={vehicle.plateNumber} /> : undefined}
        actions={
          isVoid ? undefined : (
            <span className="flex flex-wrap items-center gap-2">
              {canEditInvoice ? (
                <Link
                  href={`/finance/invoices/${invoice.id}/edit`}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted"
                >
                  <Pencil className="size-4" />
                  Edit
                </Link>
              ) : null}
              {canCredit ? (
                <Link
                  href={`/finance/invoices/${invoice.id}/credit-note`}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted"
                >
                  <FileMinus className="size-4" />
                  Credit note
                </Link>
              ) : null}
              {canSettleShort ? (
                <ShortPaymentButton
                  invoiceId={invoice.id}
                  invoiceNumber={invoice.invoiceNumber}
                  paid={invoice.paidAmount}
                  total={invoice.totalAmount.toString()}
                />
              ) : null}
              {canVoid ? (
                <VoidInvoiceButton
                  invoiceId={invoice.id}
                  invoiceNumber={invoice.invoiceNumber}
                  hasWorkOrder={Boolean(jobCard)}
                />
              ) : null}
              <StaffDocumentActions
                pdfUrl={`/documents/invoice/${invoice.id}`}
                target={{ kind: 'invoice', id: invoice.id }}
                canShare={Boolean(vehicle)}
              />
            </span>
          )
        }
      />

      {isVoid ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-4 text-sm sm:px-6"
        >
          <Ban className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="flex flex-col gap-1">
            <p className="font-semibold">
              Voided{invoice.voidedAt ? ` ${formatDateTime(invoice.voidedAt)}` : ''}
            </p>
            {invoice.voidReason ? (
              <p className="whitespace-pre-wrap text-muted-foreground">{invoice.voidReason}</p>
            ) : null}
            <p className="text-muted-foreground">
              Kept on record only. It is not owed and is not counted in any total.
            </p>
          </div>
        </div>
      ) : null}

      <Grid gap="xl" className="items-start xl:grid-cols-12">
        <Stack gap="xl" className="xl:col-span-8">
          <Section title="What was billed">
            <DocumentLinesView
              lines={invoice.items}
              totals={[
                ...discountRows,
                { label: 'Total excl. VAT', amount: invoice.subtotal },
                { label: 'VAT', amount: invoice.taxAmount },
                ...(invoice.roundingAdjustment.isZero()
                  ? []
                  : [{ label: 'Round-off', amount: invoice.roundingAdjustment.toFixed(2) }]),
                { label: 'Total', amount: invoice.totalAmount, strong: true },
                // A discount given after the invoice comes off its total; VAT stays as invoiced.
                ...(discountAfter > 0
                  ? [
                      { label: 'Discount', amount: filsToString(-discountAfter) },
                      {
                        label: 'Total after discount',
                        amount: filsToString(
                          toFils(invoice.totalAmount.toString()) - discountAfter,
                        ),
                      },
                    ]
                  : []),
                ...(credited > 0
                  ? [{ label: 'Credit notes', amount: filsToString(-credited) }]
                  : []),
                ...(advanceApplied > 0
                  ? [{ label: 'Advance applied', amount: filsToString(-advanceApplied) }]
                  : []),
                { label: 'Paid', amount: invoice.paidAmount },
                { label: 'Balance due', amount: invoice.balanceDue, strong: true },
              ]}
            />
          </Section>

          {creditNotes.length > 0 ? (
            <Section
              title="Credit notes"
              description="Tax credit notes issued against this invoice. The invoice stays as issued; each note reduces what is owed."
            >
              <Panel padding="none">
                <ul className="divide-y divide-border">
                  {creditNotes.map((note) => (
                    <li key={note.id}>
                      <Link
                        href={`/finance/credit-notes/${note.id}`}
                        className="flex flex-col gap-1 px-4 py-4 hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                      >
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span
                            className={
                              note.status === 'VOID'
                                ? 'text-sm font-medium text-muted-foreground line-through'
                                : 'text-sm font-medium'
                            }
                          >
                            {`${note.creditNoteNumber} · ${formatMoney(note.totalAmount.toString())}`}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {`${formatCalendarDate(note.issueDate)} · ${note.reason}`}
                          </span>
                        </span>
                        {note.status === 'VOID' ? (
                          <StatusPill tone="danger">Void</StatusPill>
                        ) : toFils(note.refundAmount.toString()) > 0 ? (
                          <StatusPill tone={note.refundedOn ? 'success' : 'warning'}>
                            {note.refundedOn
                              ? `Refunded ${formatMoney(note.refundAmount.toString())}`
                              : `Refund ${formatMoney(note.refundAmount.toString())} due`}
                          </StatusPill>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
            </Section>
          ) : null}

          {advances && (advances.applications.length > 0 || canApplyAdvance) ? (
            <Section
              title="Customer advances"
              description="Money the customer paid before this invoice. Applying it settles the invoice like a payment — its sales and VAT stay exactly as issued."
            >
              <Panel padding="none">
                <dl className="grid grid-cols-3 gap-4 px-4 py-4 text-sm sm:px-6">
                  {[
                    ['Advance available', advances.availableTotal],
                    ['Advance applied', invoice.advanceApplied],
                    ['Balance due', invoice.balanceDue],
                  ].map(([label, amount]) => (
                    <div key={label} className="flex flex-col gap-0.5">
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="font-semibold tabular-nums">{formatMoney(amount)}</dd>
                    </div>
                  ))}
                </dl>
                {advances.applications.length > 0 ? (
                  <ul className="divide-y divide-border border-t border-border">
                    {advances.applications.map((row) => {
                      const returned = row.amount.startsWith('-');
                      return (
                        <li
                          key={row.id}
                          className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                        >
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span
                              className={
                                row.reversedAt
                                  ? 'text-sm text-muted-foreground line-through'
                                  : 'text-sm font-medium'
                              }
                            >
                              {returned ? 'Returned to ' : 'From '}
                              <Link
                                href={`/finance/advances/${row.advance.id}`}
                                className="hover:underline"
                              >
                                {row.advance.advanceNumber}
                              </Link>
                              {` · ${formatMoney(returned ? row.amount.slice(1) : row.amount)}`}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {`${formatCalendarDate(row.allocatedOn)}${row.creditNote ? ` · by credit note ${row.creditNote.creditNoteNumber}` : ''} · ${row.createdBy}`}
                              {row.reversedAt
                                ? ` · undone${row.reversalReason ? ` — ${row.reversalReason}` : ''}`
                                : ''}
                            </span>
                          </span>
                          {advances.canApply && !isVoid && !row.reversedAt && !returned ? (
                            <UndoApplicationButton
                              allocationId={row.id}
                              label={`${row.advance.advanceNumber} on ${invoice.invoiceNumber}`}
                            />
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {canApplyAdvance ? (
                  <div className="border-t border-border bg-muted/20 px-4 py-6 sm:px-6">
                    <ApplyAdvanceForm
                      key={invoice.balanceDue}
                      side="invoice"
                      fixedId={invoice.id}
                      fixedMax={invoice.balanceDue}
                      choices={advances.available.map((advance) => ({
                        id: advance.id,
                        label: `${advance.advanceNumber} · ${formatMoney(advance.left)} left`,
                        hint: `Received ${formatCalendarDate(advance.receivedOn)}${advance.jobNumber ? ` · for ${advance.jobNumber}` : ''}`,
                        max: advance.left,
                      }))}
                      defaultChoiceId={
                        advances.available.find(
                          (advance) => jobCard && advance.jobNumber === jobCard.jobNumber,
                        )?.id
                      }
                      today={localDateString()}
                    />
                  </div>
                ) : null}
              </Panel>
            </Section>
          ) : null}

          <Section
            title="Payments"
            description="Money received against this invoice, with a receipt for each."
          >
            <Panel padding="none">
              {receipts.length > 0 ? (
                <ul className="divide-y divide-border">
                  {receipts.map((payment) => (
                    <li
                      key={payment.id}
                      className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-sm font-medium">
                          {formatMoney(payment.amount)} · {PAYMENT_METHOD_LABEL[payment.method]}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {payment.paymentNumber ? `${payment.paymentNumber} · ` : ''}
                          {formatDateTime(payment.receivedAt)}
                          {payment.receivedBy ? ` · ${payment.receivedBy.fullName}` : ''}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        {canReverse ? (
                          <ReversePaymentButton
                            invoiceId={invoice.id}
                            paymentId={payment.id}
                            label={`${formatMoney(payment.amount)} ${PAYMENT_METHOD_LABEL[payment.method].toLowerCase()}`}
                          />
                        ) : null}
                        <StaffDocumentActions
                          pdfUrl={`/documents/receipt/${payment.id}`}
                          target={{ kind: 'receipt', id: payment.id }}
                          canShare={Boolean(vehicle)}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-5 text-sm text-muted-foreground sm:px-6">No payments yet.</p>
              )}
              {reversedPayments.length > 0 ? (
                <ul className="divide-y divide-border border-t border-border bg-muted/20">
                  {reversedPayments.map((payment) => {
                    const reversal = reversals.get(payment.id)!;
                    return (
                      <li key={payment.id} className="flex flex-col gap-0.5 px-4 py-3 sm:px-6">
                        <span className="text-sm text-muted-foreground line-through">
                          {formatMoney(payment.amount)} · {PAYMENT_METHOD_LABEL[payment.method]}
                          {payment.paymentNumber ? ` · ${payment.paymentNumber}` : ''}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Reversed {formatDateTime(reversal.receivedAt)}
                          {reversal.receivedBy ? ` by ${reversal.receivedBy.fullName}` : ''}
                          {reversal.notes ? ` — ${reversal.notes}` : ''}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {invoice.paymentState !== 'PAID' && toFils(invoice.balanceDue) > 0 && canPay ? (
                <div className="border-t border-border bg-muted/20 px-4 py-6 sm:px-6">
                  <InvoicePaymentForm
                    moneyAccounts={(await getAccountChoices(user)).money}
                    modes={await getPaymentModeOptions(user.organizationId, 'receipts')}
                    key={invoice.balanceDue}
                    invoiceId={invoice.id}
                    balance={invoice.balanceDue}
                    now={toLocalDateTimeInput(new Date())}
                  />
                </div>
              ) : null}
            </Panel>
          </Section>
        </Stack>

        <Stack gap="xl" className="xl:col-span-4">
          <Section title="This invoice is for">
            <Panel padding="none">
              <ul className="divide-y divide-border text-sm">
                <li>
                  <Link
                    href={`/customers/${customer.id}`}
                    className="flex min-h-14 items-center justify-between gap-4 px-4 py-3 hover:bg-muted/60 sm:px-6"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <User className="size-4 shrink-0 text-muted-foreground" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{customer.name}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {customer.phone}
                        </span>
                      </span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
                {vehicle ? (
                  <li>
                    <Link
                      href={`/vehicles/${vehicle.id}`}
                      className="flex min-h-14 items-center justify-between gap-4 px-4 py-3 hover:bg-muted/60 sm:px-6"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <Car className="size-4 shrink-0 text-muted-foreground" />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">
                            {vehicle.make} {vehicle.model} {vehicle.year ?? ''}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {vehicle.plateNumber}
                          </span>
                        </span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ) : (
                  <li className="flex items-start gap-3 px-4 py-3 text-sm text-muted-foreground sm:px-6">
                    <Car className="mt-0.5 size-4 shrink-0" />
                    <span>
                      No vehicle on this invoice, so it can&apos;t be sent as a secure customer
                      link. The PDF prints and the invoice takes payment as normal.
                    </span>
                  </li>
                )}
                {jobCard ? (
                  <li>
                    <Link
                      href={`/job-cards/${jobCard.id}`}
                      className="flex min-h-14 items-center justify-between gap-4 px-4 py-3 hover:bg-muted/60 sm:px-6"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <ClipboardList className="size-4 shrink-0 text-muted-foreground" />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{jobCard.jobNumber}</span>
                          <span className="truncate text-xs text-muted-foreground">Job card</span>
                        </span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ) : null}
              </ul>
            </Panel>
          </Section>

          {jobCost ? (
            <Section title="Job cost & profit">
              <JobCostPanel cost={jobCost} />
            </Section>
          ) : null}

          <Section title="Invoice details">
            <Panel>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                <dt className="text-muted-foreground">Issued</dt>
                <dd className="text-right">
                  {invoice.issuedAt ? formatDateTime(invoice.issuedAt) : '—'}
                </dd>
                <dt className="text-muted-foreground">Issued by</dt>
                <dd className="text-right">{invoice.issuedBy?.fullName ?? '—'}</dd>
                <dt className="text-muted-foreground">Seller TRN</dt>
                <dd className="text-right">{invoice.sellerTaxNumber ?? '—'}</dd>
                <dt className="text-muted-foreground">Customer TRN</dt>
                <dd className="text-right">{invoice.customerTaxNumber ?? '—'}</dd>
              </dl>
              {invoice.notes ? (
                <p className="mt-4 border-t border-border pt-4 text-sm whitespace-pre-wrap">
                  {invoice.notes}
                </p>
              ) : null}
              {!isVoid && editBlocker && hasPermission(user, 'invoice.edit', branch) ? (
                <p className="mt-4 flex items-start gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
                  <Info className="mt-0.5 size-3.5 shrink-0" />
                  {editBlocker}
                </p>
              ) : null}
            </Panel>
          </Section>
        </Stack>
      </Grid>
    </Stack>
  );
}
