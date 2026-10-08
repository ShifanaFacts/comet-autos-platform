import Link from 'next/link';
import { FileCheck2 } from 'lucide-react';
import { requireUser } from '@/lib/auth/authorize';
import { listBillsAwaiting } from '@/lib/inventory/bills';
import { formatMoney } from '@/lib/format';
import { filsToString, toFils } from '@/lib/money';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusPill } from '@/components/shared/status-pill';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const dynamic = 'force-dynamic';

/**
 * Purchases recorded before the shop's tax invoice came — parts bought for a
 * job, mostly. Each waits here, its VAT held apart, until the bill is
 * matched (or it is closed as having none). Oldest first: those are the ones
 * to chase.
 */
export default async function BillsToMatchPage({
  searchParams,
}: {
  searchParams: Promise<{ matched?: string }>;
}) {
  const user = await requireUser();
  const { matched } = await searchParams;
  const bills = await listBillsAwaiting(user);
  const vatFils = bills.reduce((sum, bill) => sum + toFils(bill.taxAmount), 0);

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link href="/inventory/purchases" className="tracking-normal normal-case hover:text-foreground">
            Purchases
          </Link>
        }
        title="Bills to match"
        description={
          bills.length
            ? `${bills.length} purchase${bills.length === 1 ? '' : 's'} waiting for the shop's tax invoice — ${formatMoney(filsToString(vatFils))} of VAT that can't be claimed until each bill is matched.`
            : "Purchases recorded before the shop's tax invoice came wait here until it is matched."
        }
      />
      {matched ? (
        <p className="rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-sm font-medium text-success">
          Saved. The purchase is off the list.
        </p>
      ) : null}
      {bills.length === 0 ? (
        <EmptyState
          icon={FileCheck2}
          title="Every bill is matched"
          description="Parts bought for a job without the shop's tax invoice will appear here."
        />
      ) : (
        <Panel padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Purchase</TableHead>
                  <TableHead>Shop</TableHead>
                  <TableHead className="hidden md:table-cell">Parts</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">VAT held</TableHead>
                  <TableHead>Waiting</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bills.map((bill) => (
                  <TableRow key={bill.id} className="relative">
                    <TableCell>
                      <Link
                        href={`/inventory/purchases/${bill.id}/match`}
                        className="font-medium row-link hover:underline"
                      >
                        {bill.purchaseNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{bill.supplier.name}</TableCell>
                    <TableCell className="hidden max-w-80 truncate text-muted-foreground md:table-cell">
                      {bill.what}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(bill.totalAmount)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {formatMoney(bill.taxAmount)}
                    </TableCell>
                    <TableCell>
                      <StatusPill tone={bill.days > 14 ? 'danger' : bill.days > 3 ? 'warning' : 'neutral'}>
                        {bill.days === 0 ? 'Today' : `${bill.days} day${bill.days === 1 ? '' : 's'}`}
                      </StatusPill>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Panel>
      )}
    </Stack>
  );
}
