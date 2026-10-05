import { formatMoney } from '@/lib/format';
import type { FinanceDashboard } from '@/lib/finance/dashboard';
import { Panel, Section } from '@/components/layout/primitives';
import { cn } from '@/lib/utils';

type InvoiceSettlementSummary = NonNullable<NonNullable<FinanceDashboard['revenue']>['settlement']>;

/**
 * The invoices issued in the period and where their money stands — received,
 * paid from advances, credited, discounted later, or still due — adding up to
 * what was invoiced, VAT included. One set of invoices, so it always balances
 * (unlike Collected, which is the period's cash on any invoice).
 */
export function SettlementPanel({ settlement }: { settlement: InvoiceSettlementSummary }) {
  const rows: { label: string; amount: string; hint: string }[] = [
    {
      label: 'Received',
      amount: settlement.received,
      hint: 'Payments on these invoices, whenever they came in',
    },
    ...(Number(settlement.advancesApplied) !== 0
      ? [
          {
            label: 'Paid from customer advances',
            amount: settlement.advancesApplied,
            hint: 'Money the customer paid in advance, applied to the invoice',
          },
        ]
      : []),
    ...(Number(settlement.credited) !== 0
      ? [{ label: 'Credit notes', amount: settlement.credited, hint: 'Taken back off the invoice' }]
      : []),
    ...(Number(settlement.discounts) !== 0
      ? [
          {
            label: 'Discounts given after invoicing',
            amount: settlement.discounts,
            hint: 'Off the total; VAT unchanged',
          },
        ]
      : []),
    { label: 'Still due', amount: settlement.due, hint: 'What customers still owe on these' },
  ];
  return (
    <Section
      title="Invoices this period — where the money stands"
      description="Every invoice issued in the period, VAT included, and how it has been settled."
    >
      <Panel className="@container flex flex-col gap-0 p-0">
        <div className="flex items-baseline justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
          <span className="text-sm font-medium">Invoiced, incl. VAT</span>
          <span className="text-lg font-semibold tabular-nums">
            {formatMoney(settlement.invoiced)}
          </span>
        </div>
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-4 border-b border-border px-4 py-3 sm:px-6"
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-sm">{row.label}</span>
              <span className="text-xs text-muted-foreground">{row.hint}</span>
            </span>
            <span className="shrink-0 tabular-nums">{formatMoney(row.amount)}</span>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4 px-4 py-4 sm:px-6">
          <span className="text-sm font-medium">
            {settlement.balanced ? 'Accounted for' : 'Accounted for (more than invoiced)'}
          </span>
          <span
            className={cn(
              'font-semibold tabular-nums',
              settlement.balanced ? 'text-success' : 'text-warning',
            )}
          >
            {formatMoney(settlement.accounted)}
            {settlement.balanced ? ' ✓' : ''}
          </span>
        </div>
      </Panel>
    </Section>
  );
}
