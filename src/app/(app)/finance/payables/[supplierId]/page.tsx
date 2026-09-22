import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Mail, MapPin, Phone, Wallet } from 'lucide-react';
import { requireUser, hasPermission } from '@/lib/auth/authorize';
import { AuthError } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { getSupplierPayables } from '@/lib/finance/supplier-payments';
import { formatDate, formatMoney } from '@/lib/format';
import { Grid, PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { LinkButton } from '@/components/shared/link-button';
import { StatusPill } from '@/components/shared/status-pill';
import { TableWrap } from '@/components/shared/record-card';
import { SupplierPaymentHistory } from '@/components/finance/supplier-payment-history';

export const dynamic = 'force-dynamic';

const STATE = {
  UNPAID: { tone: 'danger', label: 'Unpaid' },
  PARTIALLY_PAID: { tone: 'warning', label: 'Part paid' },
  PAID: { tone: 'success', label: 'Paid' },
} as const;

export default async function SupplierPayablesPage({
  params,
}: {
  params: Promise<{ supplierId: string }>;
}) {
  const user = await requireUser();
  const { supplierId } = await params;

  let data;
  try {
    data = await getSupplierPayables(user, supplierId);
  } catch (error) {
    if (error instanceof AuthError) return <AccessDenied what="this supplier's account" />;
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { supplier, totals, owing, purchases, payments } = data;
  const canPay = hasPermission(user, 'accounting.create');
  const canReverse = hasPermission(user, 'accounting.edit');

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <Link
        href="/finance/payables"
        className="-ml-2 inline-flex h-11 w-fit items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Payables
      </Link>

      <PageHeader
        eyebrow="Supplier account"
        title={supplier.name}
        description={
          supplier.contactName ? `Contact: ${supplier.contactName}` : 'Money owed and money paid.'
        }
      />

      {/* The balance, said plainly, before anything else. */}
      <Panel
        className={
          totals.balanceFils > 0
            ? 'flex flex-col gap-4 border-primary/25 bg-primary/[0.04] sm:flex-row sm:items-end sm:justify-between'
            : 'flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'
        }
      >
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Outstanding</span>
          <span className="text-4xl leading-none font-semibold tracking-[-0.02em] tabular-nums">
            {formatMoney(totals.balance)}
          </span>
          <span className="text-sm text-muted-foreground">
            {formatMoney(totals.received)} received on {totals.purchaseCount} purchase
            {totals.purchaseCount === 1 ? '' : 's'} · {formatMoney(totals.paid)} paid
          </span>
        </div>
        {totals.balanceFils === 0 ? (
          <p className="flex items-center gap-2 text-sm font-medium text-success">
            <CheckCircle2 className="size-5" />
            Nothing owed
          </p>
        ) : null}
      </Panel>

      <Grid gap="xl" className="items-start xl:grid-cols-12">
        <Stack gap="2xl" className="xl:col-span-7">
          <Section
            title="Bills to pay"
            description={
              owing.length === 0
                ? 'Every received purchase from this supplier is settled.'
                : `${owing.length} purchase${owing.length === 1 ? '' : 's'} making up the balance, oldest first.`
            }
          >
            {owing.length === 0 ? (
              <Panel>
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="size-4 text-success" />
                  Nothing outstanding.
                </p>
              </Panel>
            ) : (
              <ul className="flex flex-col gap-2">
                {owing.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-4 sm:flex-row sm:items-center sm:gap-4 sm:px-6"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-medium">{row.number}</span>
                        <StatusPill tone={STATE[row.state].tone}>{STATE[row.state].label}</StatusPill>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {row.supplierInvoiceNumber ? `${row.supplierInvoiceNumber} · ` : ''}
                        {formatDate(row.date)} · {row.ageDays} days old
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatMoney(row.received)} received
                        {row.paidFils > 0 ? ` · ${formatMoney(row.paid)} paid` : ''}
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-3 sm:flex-col sm:items-end sm:gap-2">
                      <span className="flex flex-col sm:items-end">
                        <span className="text-xs text-muted-foreground">Outstanding</span>
                        <span className="text-lg font-semibold tabular-nums">
                          {formatMoney(row.balance)}
                        </span>
                      </span>
                      {canPay ? (
                        <LinkButton
                          href={`/finance/payables/${supplier.id}/pay/${row.id}`}
                          className="h-11 shrink-0"
                        >
                          <Wallet />
                          Pay
                        </LinkButton>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Purchase history"
            description="Everything received from this supplier, newest first."
          >
            <Panel padding="none" className="overflow-hidden">
              {/* Phone: cards. Desktop: a table. */}
              <ul className="divide-y divide-border md:hidden">
                {purchases.map((row) => (
                  <li key={row.id} className="flex items-start justify-between gap-3 px-4 py-3.5">
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-mono text-sm">{row.number}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(row.date)}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-sm tabular-nums">{formatMoney(row.received)}</span>
                      <StatusPill tone={STATE[row.state].tone}>{STATE[row.state].label}</StatusPill>
                    </span>
                  </li>
                ))}
              </ul>
              <TableWrap>
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                    <tr>
                      <th className="px-6 py-4">Purchase</th>
                      <th className="px-2 py-4">Date</th>
                      <th className="w-28 px-2 py-4 text-right">Received</th>
                      <th className="w-28 px-2 py-4 text-right">Paid</th>
                      <th className="w-28 px-2 py-4 text-right">Balance</th>
                      <th className="w-28 px-6 py-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {purchases.map((row) => (
                      <tr key={row.id}>
                        <td className="px-6 py-4">
                          <span className="font-mono text-xs">{row.number}</span>
                          {row.supplierInvoiceNumber ? (
                            <span className="block text-xs text-muted-foreground">
                              {row.supplierInvoiceNumber}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-2 py-4 whitespace-nowrap text-muted-foreground">
                          {formatDate(row.date)}
                        </td>
                        <td className="px-2 py-4 text-right tabular-nums">
                          {formatMoney(row.received)}
                        </td>
                        <td className="px-2 py-4 text-right tabular-nums text-muted-foreground">
                          {formatMoney(row.paid)}
                        </td>
                        <td className="px-2 py-4 text-right font-medium tabular-nums">
                          {formatMoney(row.balance)}
                        </td>
                        <td className="px-6 py-4">
                          <StatusPill tone={STATE[row.state].tone}>
                            {STATE[row.state].label}
                          </StatusPill>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              {purchases.length === 0 ? (
                <p className="px-4 py-5 text-sm text-muted-foreground sm:px-6">
                  Nothing has been received from this supplier yet.
                </p>
              ) : null}
            </Panel>
          </Section>
        </Stack>

        <Stack gap="2xl" className="xl:col-span-5">
          <Section title="Supplier">
            <Panel className="flex flex-col gap-4 text-sm">
              {[
                [Phone, 'Phone', supplier.phone],
                [Mail, 'Email', supplier.email],
                [MapPin, 'Address', supplier.address],
              ]
                .filter(([, , value]) => Boolean(value))
                .map(([Icon, label, value]) => {
                  const Rendered = Icon as typeof Phone;
                  return (
                    <div key={label as string} className="flex items-start gap-3">
                      <Rendered className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span className="flex min-w-0 flex-col">
                        <span className="text-xs text-muted-foreground">{label as string}</span>
                        <span className="break-words">{value as string}</span>
                      </span>
                    </div>
                  );
                })}
              <Link
                href={`/inventory/suppliers/${supplier.id}`}
                className="-ml-2 inline-flex h-11 w-fit items-center rounded-lg px-2 text-sm font-medium text-primary transition-colors hover:bg-muted hover:text-primary-hover"
              >
                Open the supplier record
              </Link>
            </Panel>
          </Section>

          <Section
            title="Payment history"
            description="Every payment to this supplier. Nothing is ever deleted."
          >
            <SupplierPaymentHistory payments={payments} canReverse={canReverse} />
          </Section>
        </Stack>
      </Grid>
    </Stack>
  );
}
