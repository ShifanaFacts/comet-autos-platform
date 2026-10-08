import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser, hasPermission } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { getPurchaseDetail } from '@/lib/inventory/purchases';
import { formatCalendarDate, formatDate, formatMoney, localDateString } from '@/lib/format';
import { formatMilli } from '@/lib/money';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { MatchBillForm } from '@/components/inventory/match-bill-form';

/**
 * The supplier's tax invoice for a purchase recorded before it came: typed
 * as printed and checked against what was recorded (lib/inventory/bills.ts).
 */
export default async function MatchBillPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let detail;
  try {
    detail = await getPurchaseDetail(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { purchase, lines } = detail;
  const canMatch = hasPermission(user, 'purchase.edit', { branchId: purchase.branchId });
  const since = purchase.supplierInvoiceDate ?? purchase.receivedAt ?? purchase.createdAt;

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link
            href="/inventory/purchases/bills"
            className="tracking-normal normal-case hover:text-foreground"
          >
            Bills to match
          </Link>
        }
        title={`Tax invoice for ${purchase.purchaseNumber}`}
        description={`${purchase.supplier.name} · bought ${purchase.supplierInvoiceDate ? formatCalendarDate(purchase.supplierInvoiceDate) : formatDate(since)}. Type the figures exactly as printed on the shop's bill.`}
      />

      <Panel padding="none" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2.5">Recorded on the purchase</th>
                <th className="px-3 py-2.5 text-right">Qty</th>
                <th className="px-3 py-2.5 text-right">Price</th>
                <th className="hidden px-3 py-2.5 text-right sm:table-cell">VAT</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((line) => (
                <tr key={line.id}>
                  <td className="px-4 py-2">
                    <span className="block font-medium">{line.part.name}</span>
                    <span className="block font-mono text-xs text-muted-foreground">
                      {line.part.sku}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMilli(line.orderedMilli)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMoney(line.unitCost.toString())}
                  </td>
                  <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">
                    {formatMoney(line.amounts.taxAmount)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(line.amounts.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel>
        {purchase.billStatus !== 'PENDING' ? (
          <p className="text-sm text-muted-foreground">
            {purchase.billStatus === 'RECEIVED'
              ? `The tax invoice for this purchase is matched${purchase.supplierInvoiceNumber ? ` (${purchase.supplierInvoiceNumber})` : ''}.`
              : 'This purchase is closed as having no tax invoice.'}{' '}
            <Link href={`/inventory/purchases/${purchase.id}`} className="text-primary hover:underline">
              Open the purchase
            </Link>
          </p>
        ) : !canMatch ? (
          <p className="text-sm text-muted-foreground">
            Someone who may edit purchases matches the tax invoice.
          </p>
        ) : (
          <MatchBillForm
            purchaseId={purchase.id}
            today={localDateString()}
            billDate={
              purchase.supplierInvoiceDate?.toISOString().slice(0, 10) ?? localDateString(since)
            }
            recorded={{
              subtotal: purchase.subtotal?.toString() ?? '0.00',
              taxAmount: purchase.taxAmount?.toString() ?? '0.00',
              totalAmount: purchase.totalAmount?.toString() ?? '0.00',
            }}
          />
        )}
      </Panel>
    </Stack>
  );
}
