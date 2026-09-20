import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Cog, Pencil, Plus, ShoppingCart } from 'lucide-react';
import { requireUser, hasPermission } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { getSupplierDetail } from '@/lib/inventory/suppliers';
import { formatCalendarDate, formatDate, formatMoney } from '@/lib/format';
import { Grid, PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { EmptyState } from '@/components/shared/empty-state';
import { LinkButton } from '@/components/shared/link-button';
import { StatusPill } from '@/components/shared/status-pill';
import { PurchaseStatusPill } from '@/components/inventory/purchase-status';
import { StockPill, StockQuantity } from '@/components/inventory/stock-level';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let detail;
  try {
    detail = await getSupplierDetail(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { supplier, parts, purchases, balance } = detail;
  const canManage = hasPermission(user, 'inventory.manage');
  const canPurchase = hasPermission(user, 'purchase.create');

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link
            href="/inventory/suppliers"
            className="tracking-normal normal-case hover:text-foreground"
          >
            ← Suppliers
          </Link>
        }
        title={
          <>
            {supplier.name}
            {!supplier.isActive ? <StatusPill tone="neutral">Inactive</StatusPill> : null}
          </>
        }
        description={
          [supplier.contactName, supplier.phone, supplier.email].filter(Boolean).join(' · ') ||
          'No contact details yet'
        }
        actions={
          <>
            {canManage ? (
              <LinkButton
                href={`/inventory/suppliers/${supplier.id}/edit`}
                variant="outline"
                size="lg"
              >
                <Pencil />
                Edit supplier
              </LinkButton>
            ) : null}
            {canPurchase && supplier.isActive ? (
              <LinkButton href={`/inventory/purchases/new?supplier=${supplier.id}`} size="lg">
                <Plus />
                New purchase
              </LinkButton>
            ) : null}
          </>
        }
      />

      <Grid className="sm:grid-cols-3">
        <Panel>
          <p className="text-sm text-muted-foreground">Received from supplier</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {formatMoney(balance.received)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Cost + VAT of stock received</p>
        </Panel>
        <Panel>
          <p className="text-sm text-muted-foreground">Paid</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{formatMoney(balance.paid)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Supplier payments aren&apos;t recorded in the app yet
          </p>
        </Panel>
        <Panel className={balance.outstanding !== '0.00' ? 'border-warning/40' : undefined}>
          <p className="text-sm text-muted-foreground">Outstanding</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {formatMoney(balance.outstanding)}
          </p>
        </Panel>
      </Grid>

      {supplier.address ? (
        <Section title="Address">
          <p className="text-sm whitespace-pre-line">{supplier.address}</p>
        </Section>
      ) : null}

      <Section
        title="Supplier parts"
        description="Parts this supplier is preferred for, and parts bought from them, with the last cost paid."
      >
        {parts.length === 0 ? (
          <EmptyState
            variant="inline"
            icon={Cog}
            title="No parts linked yet"
            description="Set this supplier on a part, or receive a purchase from them."
          />
        ) : (
          <Panel padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Part</TableHead>
                    <TableHead className="text-right">On hand</TableHead>
                    <TableHead className="text-right">Last cost</TableHead>
                    <TableHead className="hidden sm:table-cell">Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parts.map(({ part, preferred, lastCost, lastPurchase, onHandMilli, state }) => (
                    <TableRow key={part.id} className="relative">
                      <TableCell>
                        <Link
                          href={`/inventory/parts/${part.id}`}
                          className="font-medium after:absolute after:inset-0 hover:underline"
                        >
                          {part.name}
                        </Link>
                        <span className="block font-mono text-xs text-muted-foreground">
                          {part.sku}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-1">
                          <StockQuantity
                            onHandMilli={onHandMilli}
                            unit={part.unitOfMeasure}
                            state={state}
                          />
                          {state !== 'IN_STOCK' ? <StockPill state={state} /> : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {lastCost ? formatMoney(lastCost) : '—'}
                        {lastPurchase ? (
                          <span className="block text-xs text-muted-foreground">
                            {lastPurchase}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {preferred ? (
                          <StatusPill tone="primary">Preferred supplier</StatusPill>
                        ) : (
                          <StatusPill tone="neutral">Purchased</StatusPill>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Panel>
        )}
      </Section>

      <Section title="Purchase history">
        {purchases.length === 0 ? (
          <EmptyState variant="inline" icon={ShoppingCart} title="No purchases yet" />
        ) : (
          <Panel padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Purchase</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Lines</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchases.map((purchase) => (
                    <TableRow key={purchase.id} className="relative">
                      <TableCell>
                        <Link
                          href={`/inventory/purchases/${purchase.id}`}
                          className="font-medium after:absolute after:inset-0 hover:underline"
                        >
                          {purchase.purchaseNumber}
                        </Link>
                        {purchase.supplierInvoiceNumber ? (
                          <span className="block text-xs text-muted-foreground">
                            Inv. {purchase.supplierInvoiceNumber}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {purchase.supplierInvoiceDate
                          ? formatCalendarDate(purchase.supplierInvoiceDate)
                          : formatDate(purchase.createdAt)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        {purchase._count.items}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {purchase.totalAmount ? formatMoney(purchase.totalAmount) : '—'}
                      </TableCell>
                      <TableCell>
                        <PurchaseStatusPill status={purchase.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Panel>
        )}
      </Section>
    </Stack>
  );
}
