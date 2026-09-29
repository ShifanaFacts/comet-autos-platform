import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, Ban, FileText, User } from 'lucide-react';
import { AuthError, hasPermission, requireUser } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { creditNoteVoidBlocker, getCreditNote } from '@/lib/billing/credit-notes';
import { getAccountChoices } from '@/lib/accounting/reports';
import { PAYMENT_METHOD_LABEL } from '@/lib/documents/build';
import { formatCalendarDate, formatDateTime, formatMoney, localDateString } from '@/lib/format';
import { toFils } from '@/lib/money';
import { VAT_TREATMENT_LABEL } from '@/lib/vat-treatment';
import { Grid, PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { StatusPill } from '@/components/shared/status-pill';
import { AccessDenied } from '@/components/shared/access-denied';
import { StaffDocumentActions } from '@/components/documents/document-actions';
import {
  CreditNoteRefundForm,
  VoidCreditNoteButton,
} from '@/components/finance/credit-note-actions';

/** One tax credit note: what it takes back, why, and any refund owed under it. */
export default async function CreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  let note;
  try {
    note = await getCreditNote(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof AuthError) return <AccessDenied what="this credit note" />;
    throw error;
  }
  const branch = { branchId: note.branchId };
  const isVoid = note.status === 'VOID';
  const refund = toFils(note.refundAmount.toString());
  const canVoid = hasPermission(user, 'invoice.cancel', branch) && !creditNoteVoidBlocker(note);
  const canRefund =
    !isVoid && refund > 0 && !note.refundedOn && hasPermission(user, 'payment.reverse', branch);
  const share = toFils(note.discountAmount.toString());
  const moneyAccounts = canRefund ? (await getAccountChoices(user)).money : [];

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-x-2">
            Credit note
            <span aria-hidden>·</span>
            <Link
              href={`/finance/invoices/${note.invoice.id}`}
              className="text-primary hover:underline"
            >
              {note.invoice.invoiceNumber}
            </Link>
          </span>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {note.creditNoteNumber}
            {isVoid ? (
              <StatusPill tone="danger">Void</StatusPill>
            ) : refund > 0 && !note.refundedOn ? (
              <StatusPill tone="warning">Refund due</StatusPill>
            ) : (
              <StatusPill tone="success">Issued</StatusPill>
            )}
          </span>
        }
        description={`For ${note.invoice.customerName ?? note.customer.name} · dated ${formatCalendarDate(note.issueDate)} · ${formatMoney(note.totalAmount.toString())} including VAT`}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            {canVoid ? (
              <VoidCreditNoteButton
                creditNoteId={note.id}
                creditNoteNumber={note.creditNoteNumber}
              />
            ) : null}
            <StaffDocumentActions
              pdfUrl={`/documents/credit-note/${note.id}`}
              target={{ kind: 'invoice', id: note.invoice.id }}
              canShare={false}
            />
          </span>
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
              Voided{note.voidedAt ? ` ${formatDateTime(note.voidedAt)}` : ''}
            </p>
            {note.voidReason ? <p className="text-muted-foreground">{note.voidReason}</p> : null}
            <p className="text-muted-foreground">
              Kept on record only. The invoice is owed in full again and its entry in the books is
              reversed.
            </p>
          </div>
        </div>
      ) : null}

      <Grid gap="xl" className="items-start xl:grid-cols-12">
        <Stack gap="xl" className="xl:col-span-8">
          <Section title="What is credited" description={`Reason: ${note.reason}`}>
            <Panel padding="none" className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-muted/40 text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                    <tr>
                      <th className="px-4 py-3 pl-6">Line</th>
                      <th className="w-20 px-2 py-3 text-right">Qty</th>
                      <th className="w-28 px-2 py-3 text-right">Amount</th>
                      <th className="w-24 px-4 py-3 pr-6 text-right">VAT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {note.items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-4 py-3 pl-6">
                          <span className="block">{item.description}</span>
                          <span className="block text-xs text-muted-foreground">
                            {VAT_TREATMENT_LABEL[item.vatTreatment]}
                            {item.account
                              ? ` · ${item.account.accountCode} ${item.account.accountName}`
                              : ''}
                          </span>
                        </td>
                        <td className="px-2 py-3 text-right tabular-nums">
                          {Number(item.quantity.toString())}
                        </td>
                        <td className="px-2 py-3 text-right tabular-nums">
                          {formatMoney(item.lineTotal.toString())}
                        </td>
                        <td className="px-4 py-3 pr-6 text-right tabular-nums">
                          {formatMoney(item.taxAmount.toString())}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 border-t border-border bg-muted/20 px-4 py-4 text-sm sm:px-6">
                {share > 0 ? (
                  <>
                    <dt className="text-muted-foreground">Invoice discount taken back</dt>
                    <dd className="text-right tabular-nums">
                      −{formatMoney(note.discountAmount.toString())}
                    </dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Total excl. VAT</dt>
                <dd className="text-right tabular-nums">
                  {formatMoney(note.subtotal.toString())}
                </dd>
                <dt className="text-muted-foreground">VAT</dt>
                <dd className="text-right tabular-nums">
                  {formatMoney(note.taxAmount.toString())}
                </dd>
                <dt className="font-semibold">Total credited</dt>
                <dd className="text-right font-semibold tabular-nums">
                  {formatMoney(note.totalAmount.toString())}
                </dd>
              </dl>
            </Panel>
          </Section>

          {refund > 0 ? (
            <Section
              title="Refund"
              description="What the customer had paid beyond what they owe after this credit."
            >
              <Panel>
                {note.refundedOn ? (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                    <dt className="text-muted-foreground">Refunded</dt>
                    <dd className="text-right font-medium">
                      {formatMoney(note.refundAmount.toString())}
                    </dd>
                    <dt className="text-muted-foreground">On</dt>
                    <dd className="text-right">{formatCalendarDate(note.refundedOn)}</dd>
                    <dt className="text-muted-foreground">Method</dt>
                    <dd className="text-right">
                      {note.refundMethod ? PAYMENT_METHOD_LABEL[note.refundMethod] : '—'}
                    </dd>
                    <dt className="text-muted-foreground">Paid from</dt>
                    <dd className="text-right">
                      {note.refundAccount
                        ? `${note.refundAccount.accountCode} ${note.refundAccount.accountName}`
                        : 'Default for the method'}
                    </dd>
                    {note.refundReference ? (
                      <>
                        <dt className="text-muted-foreground">Reference</dt>
                        <dd className="text-right">{note.refundReference}</dd>
                      </>
                    ) : null}
                  </dl>
                ) : canRefund ? (
                  <CreditNoteRefundForm
                    creditNoteId={note.id}
                    invoiceId={note.invoice.id}
                    amount={note.refundAmount.toString()}
                    today={localDateString()}
                    moneyAccounts={moneyAccounts}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {isVoid
                      ? 'Void — nothing is owed back.'
                      : `${formatMoney(note.refundAmount.toString())} is owed back to the customer and not yet paid.`}
                  </p>
                )}
              </Panel>
            </Section>
          ) : null}
        </Stack>

        <Stack gap="xl" className="xl:col-span-4">
          <Section title="Against">
            <Panel padding="none">
              <ul className="divide-y divide-border text-sm">
                <li>
                  <Link
                    href={`/finance/invoices/${note.invoice.id}`}
                    className="flex min-h-14 items-center justify-between gap-4 px-4 py-3 hover:bg-muted/60 sm:px-6"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{note.invoice.invoiceNumber}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {`${formatCalendarDate(note.invoice.issueDate)} · ${formatMoney(note.invoice.totalAmount.toString())}`}
                        </span>
                      </span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
                <li>
                  <Link
                    href={`/customers/${note.customer.id}`}
                    className="flex min-h-14 items-center justify-between gap-4 px-4 py-3 hover:bg-muted/60 sm:px-6"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <User className="size-4 shrink-0 text-muted-foreground" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{note.customer.name}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {note.customer.phone}
                        </span>
                      </span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              </ul>
            </Panel>
          </Section>
          <Section title="Details">
            <Panel>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                <dt className="text-muted-foreground">Issued by</dt>
                <dd className="text-right">{note.createdBy.fullName}</dd>
                <dt className="text-muted-foreground">Recorded</dt>
                <dd className="text-right">{formatDateTime(note.createdAt)}</dd>
                <dt className="text-muted-foreground">Branch</dt>
                <dd className="text-right">{note.branch.name}</dd>
                <dt className="text-muted-foreground">Customer TRN</dt>
                <dd className="text-right">{note.invoice.customerTaxNumber ?? '—'}</dd>
              </dl>
            </Panel>
          </Section>
        </Stack>
      </Grid>
    </Stack>
  );
}
