import type { EstimateItemType } from '@/generated/prisma/enums';
import { Panel } from '@/components/layout/primitives';
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
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          {groups.map((group) => (
            <tbody key={group.title} className="border-b border-border">
              <tr className="bg-muted/40 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <th className="px-4 py-3 pl-6">{group.title}</th>
                <th className="w-20 px-2 py-3 text-right">{group.qty}</th>
                <th className="w-32 px-2 py-3 text-right">Price</th>
                <th className="w-20 px-2 py-3 text-right">VAT</th>
                <th className="w-32 px-4 py-3 pr-6 text-right">Amount</th>
              </tr>
              {group.items.map((item) => (
                <tr key={item.id} className="border-t border-border">
                  <td className="px-4 py-3 pl-6">{item.description}</td>
                  <td className="px-2 py-3 text-right tabular-nums">{trimQuantity(item.quantity.toString())}</td>
                  <td className="px-2 py-3 text-right tabular-nums">{formatMoney(item.unitPrice)}</td>
                  <td className="px-2 py-3 text-right text-muted-foreground tabular-nums">{trimQuantity(item.taxRate?.toString() ?? '0')}%</td>
                  <td className="px-4 py-3 pr-6 text-right font-medium tabular-nums">{formatMoney(item.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
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
