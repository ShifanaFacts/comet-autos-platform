import Link from 'next/link';
import { Info, Percent, ShieldCheck } from 'lucide-react';
import { requireUser } from '@/lib/auth/authorize';
import { AuthError } from '@/lib/auth/authorize';
import { getVatReturn, type VatReturn } from '@/lib/finance/vat';
import { formatCalendarDate, formatDate, formatMoney } from '@/lib/format';
import { PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { AccessDenied } from '@/components/shared/access-denied';
import { EmptyState } from '@/components/shared/empty-state';
import { FinancePeriodPicker } from '@/components/finance/period-picker';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/** One line of the return: its box number, what it is, the amount and the VAT. */
function Box({
  box,
  label,
  amount,
  vat,
  strong,
}: {
  box: string;
  label: string;
  amount?: string;
  vat?: string;
  strong?: boolean;
}) {
  return (
    <li
      className={cn(
        'grid grid-cols-[2.5rem_1fr_auto] items-baseline gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[2.5rem_1fr_9rem_9rem] sm:px-6',
        strong && 'bg-muted/40 font-semibold',
      )}
    >
      <span className="font-mono text-xs text-muted-foreground">{box}</span>
      <span className="text-sm">{label}</span>
      <span className="text-right text-sm tabular-nums sm:col-auto">
        {amount !== undefined ? formatMoney(amount) : ''}
      </span>
      <span className="col-start-3 text-right text-sm tabular-nums sm:col-start-auto">
        {vat !== undefined ? formatMoney(vat) : ''}
      </span>
    </li>
  );
}

/** A list of the documents behind one side of the return. */
function DocumentTable({
  rows,
  empty,
}: {
  rows: {
    key: string;
    href?: string;
    number: string;
    date: string;
    party: string;
    detail?: string | null;
    net: string;
    vat: string;
  }[];
  empty: string;
}) {
  if (rows.length === 0) {
    return (
      <Panel>
        <p className="text-sm text-muted-foreground">{empty}</p>
      </Panel>
    );
  }
  return (
    <Panel padding="none" className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-muted/40 text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
            <tr>
              <th className="w-28 px-4 py-3 pl-6">Date</th>
              <th className="px-2 py-3">Document</th>
              <th className="w-28 px-2 py-3 text-right">Net</th>
              <th className="w-28 px-4 py-3 pr-6 text-right">VAT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="px-4 py-3 pl-6 tabular-nums whitespace-nowrap">{row.date}</td>
                <td className="px-2 py-3">
                  {row.href ? (
                    <Link href={row.href} className="font-mono text-xs hover:underline">
                      {row.number}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs">{row.number}</span>
                  )}
                  <span className="block">{row.party}</span>
                  {row.detail ? (
                    <span className="block text-xs text-muted-foreground">{row.detail}</span>
                  ) : null}
                </td>
                <td className="px-2 py-3 text-right tabular-nums whitespace-nowrap">
                  {formatMoney(row.net)}
                </td>
                <td className="px-4 py-3 pr-6 text-right font-medium tabular-nums whitespace-nowrap">
                  {formatMoney(row.vat)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export default async function VatPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  let data: VatReturn;
  try {
    data = await getVatReturn(user, params);
  } catch (error) {
    if (error instanceof AuthError) return <AccessDenied what="the VAT return" />;
    throw error;
  }
  const { period, boxes } = data;
  const payable = boxes.netFils >= 0;

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow="Finance"
        title="VAT"
        description={`The figures for your VAT return, from ${formatDate(period.from)} to ${formatDate(period.to)}. Check them before filing — this prepares the return, it does not submit it.`}
      />

      <FinancePeriodPicker
        period={period}
        basePath="/finance/vat"
        presets={['month', 'last-month', 'quarter', 'last-quarter', 'year']}
      />

      {!data.registered ? (
        <Panel className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">This workshop is not VAT-registered</p>
            <p className="text-sm text-muted-foreground">
              No VAT is charged or recovered, so there is nothing to file. Turn VAT registration on
              in{' '}
              <Link href="/settings" className="text-primary hover:underline">
                Settings
              </Link>{' '}
              if that changes.
            </p>
          </div>
        </Panel>
      ) : (
        <>
          <Panel className="grid gap-6 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Output VAT</span>
              <span className="text-2xl leading-none font-semibold tabular-nums">
                {formatMoney(boxes.outputVat)}
              </span>
              <span className="text-xs text-muted-foreground">
                On {data.sales.length} tax invoice{data.sales.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Input VAT</span>
              <span className="text-2xl leading-none font-semibold tabular-nums">
                {formatMoney(boxes.inputVat)}
              </span>
              <span className="text-xs text-muted-foreground">Expenses and parts received</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                {payable ? 'VAT payable' : 'VAT refundable'}
              </span>
              <span
                className={cn(
                  'text-2xl leading-none font-semibold tabular-nums',
                  payable ? 'text-foreground' : 'text-success',
                )}
              >
                {formatMoney(boxes.net.replace('-', ''))}
              </span>
              <span className="text-xs text-muted-foreground">
                {data.taxNumber ? `TRN ${data.taxNumber}` : 'No TRN recorded in Settings'} · at{' '}
                {data.rate.replace(/\.?0+$/, '')}%
              </span>
            </div>
          </Panel>

          <Section
            title="The return"
            description="Laid out as the VAT201 form. Amounts exclude VAT."
          >
            <Panel padding="none" className="overflow-hidden">
              <div className="hidden grid-cols-[2.5rem_1fr_9rem_9rem] gap-x-3 bg-muted/40 px-6 py-3 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase sm:grid">
                <span>Box</span>
                <span>Description</span>
                <span className="text-right">Amount</span>
                <span className="text-right">VAT</span>
              </div>
              <ul className="divide-y divide-border">
                <Box
                  box="1"
                  label="Standard-rated supplies"
                  amount={boxes.standardSupplies}
                  vat={boxes.outputVat}
                />
                <Box box="4" label="Zero-rated supplies" amount={boxes.zeroRatedSupplies} />
                <Box
                  box="8"
                  label="Total supplies"
                  amount={boxes.totalSupplies}
                  vat={boxes.outputVat}
                  strong
                />
                <Box
                  box="9"
                  label="Standard-rated expenses"
                  amount={boxes.standardExpenses}
                  vat={boxes.inputVat}
                />
                <Box
                  box="11"
                  label="Total expenses"
                  amount={boxes.standardExpenses}
                  vat={boxes.inputVat}
                  strong
                />
                <Box box="12" label="Total value of due tax" vat={boxes.outputVat} />
                <Box box="13" label="Total value of recoverable tax" vat={boxes.inputVat} />
                <Box
                  box="14"
                  label={payable ? 'Payable tax for the period' : 'Refundable tax for the period'}
                  vat={boxes.net.replace('-', '')}
                  strong
                />
              </ul>
            </Panel>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              Supplies are reported for the emirate of the workshop. Exempt supplies, reverse-charge
              imports and adjustments are not recorded in the system — add them on the form if they
              apply.
            </p>
          </Section>
        </>
      )}

      <Section
        title="Sales"
        description="Tax invoices issued in the period. Pro-forma, draft, voided and cancelled invoices are not supplies."
      >
        <DocumentTable
          empty="No tax invoices were issued in this period."
          rows={data.sales.map((row) => ({
            key: row.id,
            href: row.jobCardId ? `/job-cards/${row.jobCardId}` : `/finance/invoices/${row.id}`,
            number: row.number,
            date: formatCalendarDate(row.date),
            party: row.party,
            detail: row.taxNumber ? `TRN ${row.taxNumber}` : null,
            net: row.net,
            vat: row.vat,
          }))}
        />
      </Section>

      <Section
        title="Parts received"
        description={`Deliveries booked into stock in the period, with the VAT on them${data.registered ? ` (${formatMoney(boxes.purchaseVat)})` : ''}.`}
      >
        <DocumentTable
          empty="No parts carrying VAT were received in this period."
          rows={data.purchases.map((row) => ({
            key: row.id,
            href: `/inventory/purchases/${row.id}`,
            number: row.number,
            date: formatDate(row.date),
            party: row.party,
            detail: row.reference ? `Supplier invoice ${row.reference}` : null,
            net: row.net,
            vat: row.vat,
          }))}
        />
      </Section>

      <Section
        title="Expenses"
        description={`Recorded expenses that carry VAT${data.registered ? ` (${formatMoney(boxes.expenseVat)})` : ''}. Voided expenses never count.`}
      >
        {data.expenses.length === 0 && data.sales.length === 0 && data.purchases.length === 0 ? (
          <EmptyState
            icon={Percent}
            title="Nothing to report for this period"
            description="Choose a different period, or record invoices and expenses first."
          />
        ) : (
          <DocumentTable
            empty="No expenses carrying VAT were recorded in this period."
            rows={data.expenses.map((row) => ({
              key: row.id,
              href: '/finance/expenses',
              number: row.number ?? '—',
              date: formatCalendarDate(row.date),
              party: row.party,
              detail: row.description,
              net: row.net,
              vat: row.vat,
            }))}
          />
        )}
      </Section>
    </Stack>
  );
}
