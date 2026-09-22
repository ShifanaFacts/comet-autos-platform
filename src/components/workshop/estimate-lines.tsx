import type { EstimateItemType } from '@/generated/prisma/enums';
import { Panel } from '@/components/layout/primitives';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

/*
 * The priced lines of a quotation or an invoice, read-only, in the layout of
 * the workshop's own sheet: S.No · Type · Description · Qty · Price · Amount,
 * then Total excl. VAT / VAT / Total. Cards on a phone, the table from a
 * tablet up — the same numbering in both.
 */

interface LineLike {
  id: string;
  itemType: EstimateItemType | null;
  description: string;
  quantity: { toString(): string };
  unitPrice: { toString(): string };
  lineTotal: { toString(): string };
  taxRate: { toString(): string } | null;
}

export function trimQuantity(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

const TYPE_LABEL: Partial<Record<EstimateItemType, string>> = { PART: 'Parts', LABOUR: 'Labour' };

const rateOf = (line: LineLike) => trimQuantity(line.taxRate?.toString() ?? '0');

export function DocumentLinesView({
  lines,
  totals,
}: {
  lines: LineLike[];
  totals: { label: string; amount: { toString(): string }; strong?: boolean }[];
}) {
  const rates = new Set(lines.map(rateOf));
  const oneRate = rates.size <= 1 ? [...rates][0] : null;
  const labelled = totals.map((total) =>
    total.label === 'VAT' && oneRate ? { ...total, label: `VAT ${oneRate}%` } : total,
  );

  return (
    <Panel padding="none" className="overflow-hidden">
      {/* Phone: one card per line, numbered like the sheet. */}
      <ol className="divide-y divide-border md:hidden">
        {lines.map((line, index) => (
          <li key={line.id} className="flex items-start gap-3 px-4 py-3.5">
            <span className="w-6 shrink-0 pt-0.5 text-right text-xs text-muted-foreground tabular-nums">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{line.description}</span>
              <span className="flex flex-wrap gap-x-2 pt-0.5 text-xs text-muted-foreground tabular-nums">
                {line.itemType && TYPE_LABEL[line.itemType] ? (
                  <span className="font-semibold tracking-wide uppercase">{TYPE_LABEL[line.itemType]}</span>
                ) : null}
                <span>
                  {trimQuantity(line.quantity.toString())} × {formatMoney(line.unitPrice)}
                </span>
                {oneRate === null ? <span>VAT {rateOf(line)}%</span> : null}
              </span>
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(line.lineTotal)}</span>
          </li>
        ))}
      </ol>

      {/* Tablet and up: the sheet. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
            <tr>
              <th className="w-14 px-4 py-3 text-right">S.No</th>
              <th className="w-24 px-2 py-3">Type</th>
              <th className="px-2 py-3">Description</th>
              <th className="w-20 px-2 py-3 text-right">Qty</th>
              <th className="w-32 px-2 py-3 text-right">Price</th>
              {oneRate === null ? <th className="w-20 px-2 py-3 text-right">VAT</th> : null}
              <th className="w-32 px-4 py-3 pr-6 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((line, index) => (
              <tr key={line.id}>
                <td className="px-4 py-3.5 text-right text-muted-foreground tabular-nums">{index + 1}</td>
                <td className="px-2 py-3.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {line.itemType ? (TYPE_LABEL[line.itemType] ?? '') : ''}
                </td>
                <td className="px-2 py-3.5">{line.description}</td>
                <td className="px-2 py-3.5 text-right tabular-nums whitespace-nowrap">
                  {trimQuantity(line.quantity.toString())}
                </td>
                <td className="px-2 py-3.5 text-right tabular-nums whitespace-nowrap">
                  {formatMoney(line.unitPrice)}
                </td>
                {oneRate === null ? (
                  <td className="px-2 py-3.5 text-right text-muted-foreground tabular-nums whitespace-nowrap">
                    {rateOf(line)}%
                  </td>
                ) : null}
                <td className="px-4 py-3.5 pr-6 text-right font-semibold tabular-nums whitespace-nowrap">
                  {formatMoney(line.lineTotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="ml-auto flex w-full flex-col gap-2.5 border-t border-border bg-muted/20 px-4 py-5 text-sm sm:w-96 sm:px-6">
        {labelled.map((total) => (
          <div
            key={total.label}
            className={cn(
              'flex justify-between gap-4',
              total.strong && 'border-t border-border pt-2.5 text-base font-semibold',
            )}
          >
            <dt className={total.strong ? undefined : 'text-muted-foreground'}>{total.label}</dt>
            <dd className="tabular-nums">{formatMoney(total.amount)}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

/** A quotation's lines and totals. */
export function EstimateLines({
  estimate,
}: {
  estimate: {
    items: LineLike[];
    subtotal: { toString(): string };
    taxAmount: { toString(): string };
    totalAmount: { toString(): string };
  };
}) {
  return (
    <DocumentLinesView
      lines={estimate.items}
      totals={[
        { label: 'Total excl. VAT', amount: estimate.subtotal },
        { label: 'VAT', amount: estimate.taxAmount },
        { label: 'Total', amount: estimate.totalAmount, strong: true },
      ]}
    />
  );
}
