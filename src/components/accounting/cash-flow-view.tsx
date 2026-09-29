import { Info } from 'lucide-react';
import type { CashFlowStatement } from '@/lib/accounting/cash-flow';
import { formatMoney } from '@/lib/format';
import { Panel, Section, Stack } from '@/components/layout/primitives';
import { cn } from '@/lib/utils';

/** An amount as a statement prints it: outflows in brackets. */
function statementAmount(amount: string) {
  return amount.startsWith('-') ? `(${formatMoney(amount.slice(1))})` : formatMoney(amount);
}

function Row({
  label,
  amount,
  tone,
}: {
  label: string;
  amount?: string;
  tone?: 'heading' | 'subtotal' | 'total';
}) {
  return (
    <li
      className={cn(
        'flex items-baseline justify-between gap-4 px-4 py-2.5 text-sm sm:px-6',
        tone === 'heading' && 'bg-muted/30 pt-4 font-medium',
        tone === 'subtotal' && 'bg-muted/40 font-medium',
        tone === 'total' && 'bg-muted/60 text-base font-semibold',
      )}
    >
      <span className={cn('min-w-0', !tone && 'pl-4')}>{label}</span>
      {amount !== undefined ? (
        <span className="shrink-0 tabular-nums">{statementAmount(amount)}</span>
      ) : null}
    </li>
  );
}

/** The statement of cash flows, indirect method (IAS 7). */
export function CashFlowView({ data }: { data: CashFlowStatement }) {
  const negate = (amount: string) => (amount.startsWith('-') ? amount.slice(1) : `-${amount}`);
  return (
    <Stack gap="xl">
      <Panel className="grid gap-6 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Cash at the beginning</span>
          <span className="text-2xl leading-none font-semibold tabular-nums">
            {formatMoney(data.opening)}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            Net increase / (decrease)
          </span>
          <span
            className={cn(
              'text-2xl leading-none font-semibold tabular-nums',
              data.netChangeFils < 0 ? 'text-danger' : 'text-success',
            )}
          >
            {statementAmount(data.netChange)}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Cash at the end</span>
          <span className="text-2xl leading-none font-semibold tabular-nums">
            {formatMoney(data.closing)}
          </span>
        </div>
      </Panel>

      <Section
        title="Statement of cash flows"
        description="Indirect method. Figures in brackets are cash paid out."
      >
        <Panel padding="none" className="overflow-hidden">
          <ul className="divide-y divide-border">
            <Row label="Cash flows from operating activities" tone="heading" />
            <Row label="Net profit for the period" amount={data.operating.profit} />
            {data.operating.depreciation !== '0.00' ? (
              <Row label="Adjustment: depreciation" amount={data.operating.depreciation} />
            ) : null}
            {data.operating.disposalGain !== '0.00' ? (
              <Row
                label="Adjustment: (gain) / loss on disposal of fixed assets"
                amount={negate(data.operating.disposalGain)}
              />
            ) : null}
            {data.operating.workingCapital.map((row) => (
              <Row key={row.key} label={row.label} amount={row.amount} />
            ))}
            <Row
              label="Net cash from operating activities"
              amount={data.operating.total}
              tone="subtotal"
            />

            <Row label="Cash flows from investing activities" tone="heading" />
            {data.investing.rows.map((row) => (
              <Row key={row.key} label={row.label} amount={row.amount} />
            ))}
            <Row
              label="Net cash from investing activities"
              amount={data.investing.total}
              tone="subtotal"
            />

            <Row label="Cash flows from financing activities" tone="heading" />
            {data.financing.rows.map((row) => (
              <Row key={row.key} label={row.label} amount={row.amount} />
            ))}
            <Row
              label="Net cash from financing activities"
              amount={data.financing.total}
              tone="subtotal"
            />

            <Row
              label="Net increase / (decrease) in cash and cash equivalents"
              amount={data.netChange}
              tone="total"
            />
            <Row
              label={`Cash and cash equivalents at the beginning of the period${
                data.broughtIn !== '0.00' ? ' (including opening balances)' : ''
              }`}
              amount={data.opening}
            />
            <Row
              label="Cash and cash equivalents at the end of the period"
              amount={data.closing}
              tone="total"
            />
          </ul>
        </Panel>
        {data.reconciles ? (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            Cash and cash equivalents are the money accounts — cash, bank, card settlements and
            petty cash. Investing covers the fixed asset accounts (1500–1599); financing covers
            equity, loans and the owner&apos;s current account (2510–2599).
          </p>
        ) : (
          <p className="text-sm text-danger">
            The flows differ from the change in cash by {formatMoney(data.difference)}. Check the
            trial balance — an account may be classified in the wrong section.
          </p>
        )}
      </Section>
    </Stack>
  );
}
