import type { EstimateItemType } from '@/generated/prisma/enums';
import { Panel } from '@/components/layout/primitives';
import { RecordCard, RecordList, TableWrap } from '@/components/shared/record-card';
import { formatMoney } from '@/lib/format';

interface LineLike {
  id: string;
  itemType: EstimateItemType;
  description: string;
  quantity: { toString(): string };
  unitPrice: { toString(): string };
  lineTotal: { toString(): string };
  taxRate: { toString(): string } | null;
}

export function trimQuantity(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

/** Read-only quotation lines grouped into labour and parts, with totals. */
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
  const groups = [
    { title: 'Labour', items: estimate.items.filter((i) => i.itemType === 'LABOUR'), qty: 'Hours' },
    { title: 'Parts', items: estimate.items.filter((i) => i.itemType !== 'LABOUR'), qty: 'Qty' },
  ].filter((group) => group.items.length > 0);

  return (
    <Panel padding="none" className="overflow-hidden">
      {/* Phone: one card per line, with its price and VAT beside their labels. */}
      <div className="md:hidden">
        {groups.map((group) => (
          <div key={group.title} className="border-b border-border">
            <p className="bg-muted/40 px-4 py-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {group.title}
            </p>
            <RecordList>
              {group.items.map((item) => (
                <RecordCard
                  key={item.id}
                  title={item.description}
                  amount={formatMoney(item.lineTotal)}
                  details={[
                    { label: group.qty, value: trimQuantity(item.quantity.toString()) },
                    { label: 'Price', value: formatMoney(item.unitPrice) },
                    { label: 'VAT', value: `${trimQuantity(item.taxRate?.toString() ?? '0')}%` },
                  ]}
                />
              ))}
            </RecordList>
          </div>
        ))}
      </div>
      <TableWrap>
        <table className="w-full min-w-[560px] text-sm">
          {groups.map((group) => (
            <tbody key={group.title} className="border-b border-border">
              <tr className="bg-muted/40 text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                <th className="px-4 py-4 pl-6">{group.title}</th>
                <th className="w-20 px-2 py-3 text-right">{group.qty}</th>
                <th className="w-32 px-2 py-3 text-right">Price</th>
                <th className="w-20 px-2 py-3 text-right">VAT</th>
                <th className="w-32 px-4 py-3 pr-6 text-right">Amount</th>
              </tr>
              {group.items.map((item) => (
                <tr key={item.id} className="border-t border-border">
                  <td className="px-4 py-4 pl-6">{item.description}</td>
                  <td className="px-2 py-4 text-right tabular-nums whitespace-nowrap">
                    {trimQuantity(item.quantity.toString())}
                  </td>
                  <td className="px-2 py-4 text-right tabular-nums whitespace-nowrap">
                    {formatMoney(item.unitPrice)}
                  </td>
                  <td className="px-2 py-4 text-right text-muted-foreground tabular-nums whitespace-nowrap">
                    {trimQuantity(item.taxRate?.toString() ?? '0')}%
                  </td>
                  <td className="px-4 py-4 pr-6 text-right font-semibold tabular-nums whitespace-nowrap">
                    {formatMoney(item.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </TableWrap>
      <dl className="ml-auto flex w-full flex-col gap-3 px-4 py-6 text-sm sm:w-96 sm:px-6">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="tabular-nums">{formatMoney(estimate.subtotal)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">VAT</dt>
          <dd className="tabular-nums">{formatMoney(estimate.taxAmount)}</dd>
        </div>
        <div className="flex justify-between border-t border-border pt-3 text-base font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatMoney(estimate.totalAmount)}</dd>
        </div>
      </dl>
    </Panel>
  );
}
