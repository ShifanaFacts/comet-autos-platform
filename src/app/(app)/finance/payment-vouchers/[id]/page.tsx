import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download, Printer } from 'lucide-react';
import { AuthError, requireUser } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { getPaymentVoucher, getPaymentVoucherFormOptions } from '@/lib/finance/payment-vouchers';
import { METHOD_LABEL } from '@/lib/accounting/payment-modes';
import { formatCalendarDate, formatDateTime, formatMoney, localDateString } from '@/lib/format';
import { filsToString, toFils } from '@/lib/money';
import { Grid, PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { StatusPill } from '@/components/shared/status-pill';
import { PayOverForm, VoidVoucherButton } from '@/components/finance/payment-voucher-forms';

/** What each change in the history means, in words. */
const ACTION_LABEL: Record<string, string> = {
  'payment_voucher.recorded': 'Recorded',
  'payment_voucher.paid': 'Paid over',
  'payment_voucher.voided': 'Voided',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right break-words">{children}</dd>
    </>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span
        className={
          strong
            ? 'text-2xl leading-none font-semibold tabular-nums'
            : 'text-2xl leading-none tabular-nums'
        }
      >
        {value}
      </span>
    </div>
  );
}

/** One payment voucher: the figures, printing it, paying it over, and how it was booked. */
export default async function PaymentVoucherPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let voucher;
  try {
    voucher = await getPaymentVoucher(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof AuthError) return <AccessDenied what="payment vouchers" />;
    throw error;
  }
  const options = voucher.canPay ? await getPaymentVoucherFormOptions(user) : null;
  const isCard = voucher.kind === 'CARD_COLLECTION';
  const isVoid = voucher.status === 'VOID';
  const paid = voucher.amount?.toString() ?? null;
  const pdf = `/documents/payment-voucher/${voucher.id}`;

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link href="/finance/payment-vouchers" className="text-primary hover:underline">
            {`Payment vouchers · ${voucher.voucherNumber}`}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {voucher.payeeName}
            {isVoid ? (
              <StatusPill tone="danger">Void</StatusPill>
            ) : voucher.status === 'OWED' ? (
              <StatusPill tone="warning">Owed to them</StatusPill>
            ) : (
              <StatusPill tone="success">Paid</StatusPill>
            )}
          </span>
        }
        description={voucher.description}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <a
              href={pdf}
              target="_blank"
              rel="noopener"
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            >
              <Printer className="size-4" />
              Print voucher
            </a>
            <a
              href={`${pdf}?download=1`}
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted"
            >
              <Download className="size-4" />
              Download
            </a>
            {voucher.canVoid ? (
              <VoidVoucherButton
                voucherId={voucher.id}
                label={voucher.voucherNumber}
                isWork={!isCard}
              />
            ) : null}
          </span>
        }
      />

      {isVoid && voucher.voidReason ? (
        <p role="status" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm sm:px-6">
          {`Voided${voucher.voidedAt ? ` on ${formatDateTime(voucher.voidedAt)}` : ''}: ${voucher.voidReason}`}
        </p>
      ) : null}

      <Grid gap="xl" className="items-start xl:grid-cols-12">
        <Stack gap="xl" className="xl:col-span-7">
          {isCard ? (
            <Panel className="grid gap-6 sm:grid-cols-3">
              <Figure label="Collected on the card" value={formatMoney(voucher.collectedAmount!.toString())} />
              <Figure
                label="Bank's fee + VAT"
                value={formatMoney(
                  filsToString(
                    toFils(voucher.feeAmount.toString()) + toFils(voucher.feeVatAmount.toString()),
                  ),
                )}
              />
              <Figure label="Handed over" value={paid ? formatMoney(paid) : '—'} strong />
            </Panel>
          ) : (
            <Panel className="grid gap-6 sm:grid-cols-2">
              <Figure label="Paid" value={paid ? formatMoney(paid) : '—'} strong />
              <Figure
                label="Booked as"
                value={voucher.expense?.chartOfAccount?.accountName ?? 'Miscellaneous expenses'}
              />
            </Panel>
          )}

          {voucher.canPay && options ? (
            <Section
              title="Pay it over"
              description="Hand over the card money less what the bank keeps — its fee and the VAT on it. Then print the voucher for them to sign."
            >
              <Panel>
                <PayOverForm
                  voucherId={voucher.id}
                  collected={voucher.collectedAmount!.toString()}
                  options={options}
                  today={localDateString()}
                />
              </Panel>
            </Section>
          ) : null}

          <Section title="Details">
            <Panel>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                <Row label="Voucher number">{voucher.voucherNumber}</Row>
                <Row label="Paid to">
                  {`${voucher.payeeName}${voucher.payeePhone ? ` · ${voucher.payeePhone}` : ''}`}
                </Row>
                {isCard ? (
                  <>
                    <Row label="Card payment">
                      {`${formatMoney(voucher.collectedAmount!.toString())} on ${formatCalendarDate(voucher.collectedOn!)}${voucher.cardReference ? ` · slip ${voucher.cardReference}` : ''}`}
                    </Row>
                    {voucher.cardAccount ? (
                      <Row label="Into">{voucher.cardAccount.accountName}</Row>
                    ) : null}
                    {voucher.status !== 'OWED' ? (
                      <>
                        <Row label="Bank's fee">
                          {`${formatMoney(voucher.feeAmount.toString())}${voucher.feeRate ? ` (${voucher.feeRate.toString().replace(/\.?0+$/, '')}%)` : ''}`}
                        </Row>
                        <Row label="VAT on the fee">{formatMoney(voucher.feeVatAmount.toString())}</Row>
                      </>
                    ) : null}
                  </>
                ) : (
                  <>
                    {voucher.expense ? (
                      <Row label="Expense">
                        <Link
                          href={`/finance/expenses/${voucher.expense.id}`}
                          className="text-primary hover:underline"
                        >
                          {voucher.expense.expenseNumber ?? 'Open'}
                        </Link>
                      </Row>
                    ) : null}
                    {voucher.expense?.jobCard ? (
                      <Row label="For job">
                        <Link
                          href={`/job-cards/${voucher.expense.jobCard.id}`}
                          className="text-primary hover:underline"
                        >
                          {voucher.expense.jobCard.jobNumber}
                        </Link>
                      </Row>
                    ) : voucher.expense?.invoice ? (
                      <Row label="For job">
                        <Link
                          href={`/finance/invoices/${voucher.expense.invoice.id}`}
                          className="text-primary hover:underline"
                        >
                          {voucher.expense.invoice.invoiceNumber}
                        </Link>
                      </Row>
                    ) : null}
                  </>
                )}
                {voucher.paidOn ? <Row label="Paid on">{formatCalendarDate(voucher.paidOn)}</Row> : null}
                {voucher.paymentMethod ? (
                  <Row label="Paid from">
                    {voucher.paidFrom
                      ? `${voucher.paidFrom.accountName} (${voucher.paidFrom.accountCode})`
                      : METHOD_LABEL[voucher.paymentMethod]}
                  </Row>
                ) : null}
                {voucher.paymentReference ? (
                  <Row label="Reference">{voucher.paymentReference}</Row>
                ) : null}
                <Row label="Branch">{voucher.branch.name}</Row>
                <Row label="Recorded">
                  {`${formatDateTime(voucher.createdAt)} by ${voucher.createdBy.fullName}`}
                </Row>
              </dl>
              {voucher.notes ? (
                <p className="mt-4 border-t border-border pt-4 text-sm whitespace-pre-wrap">
                  {voucher.notes}
                </p>
              ) : null}
            </Panel>
          </Section>
        </Stack>

        <Stack gap="xl" className="xl:col-span-5">
          <Section
            title="In the books"
            description={
              isCard
                ? 'The card money as owed to them, and paying it over. The bank’s fee on it comes off Bank charges, its VAT off what the workshop reclaims.'
                : 'Booked as an expense, paid from the account shown.'
            }
          >
            <Panel padding="none" className="overflow-hidden">
              {voucher.entries.length === 0 ? (
                <p className="px-4 py-5 text-sm text-muted-foreground sm:px-6">Not booked yet.</p>
              ) : (
                <div className="divide-y divide-border">
                  {voucher.entries.map((entry) => (
                    <div key={entry.id} className={entry.superseded ? 'bg-muted/30 text-muted-foreground' : ''}>
                      <p className="flex flex-wrap items-center gap-2 px-4 pt-3 text-xs sm:px-6">
                        <span className="font-mono">{entry.entryNumber}</span>
                        <span>{formatCalendarDate(entry.entryDate)}</span>
                        {entry.reversalOfJournalEntryId ? (
                          <StatusPill tone="neutral">Reversal</StatusPill>
                        ) : entry.superseded ? (
                          <StatusPill tone="neutral">Reversed</StatusPill>
                        ) : null}
                      </p>
                      <table className="w-full text-sm">
                        <tbody>
                          {entry.lines.map((line, index) => (
                            <tr key={index}>
                              <td className="px-4 py-1.5 sm:px-6">
                                {`${line.chartOfAccount.accountCode} ${line.chartOfAccount.accountName}`}
                              </td>
                              <td className="w-24 px-2 py-1.5 text-right tabular-nums">
                                {Number(line.debitAmount.toString()) > 0
                                  ? formatMoney(line.debitAmount.toString())
                                  : ''}
                              </td>
                              <td className="w-24 px-4 py-1.5 text-right tabular-nums sm:pr-6">
                                {Number(line.creditAmount.toString()) > 0
                                  ? formatMoney(line.creditAmount.toString())
                                  : ''}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </Section>

          {voucher.history.length ? (
            <Section title="History">
              <Panel padding="none">
                <ul className="divide-y divide-border text-sm">
                  {voucher.history.map((event) => (
                    <li key={event.id} className="flex flex-wrap justify-between gap-2 px-4 py-3 sm:px-6">
                      <span>{ACTION_LABEL[event.action] ?? event.action}</span>
                      <span className="text-muted-foreground">
                        {`${formatDateTime(event.createdAt)}${event.actorUser ? ` · ${event.actorUser.fullName}` : ''}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </Section>
          ) : null}
        </Stack>
      </Grid>
    </Stack>
  );
}
