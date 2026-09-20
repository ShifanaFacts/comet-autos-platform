import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PackageCheck, Pencil } from 'lucide-react';
import { requireUser, hasPermission } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { getPurchaseDetail } from '@/lib/inventory/purchases';
import { formatCalendarDate, formatDateTime, formatMoney } from '@/lib/format';
import { formatMilli, signedToMilli } from '@/lib/money';
import { Grid, PageHeader, Panel, Section, Stack } from '@/components/layout/primitives';
import { EmptyState } from '@/components/shared/empty-state';
import { LinkButton } from '@/components/shared/link-button';
import { StatusPill } from '@/components/shared/status-pill';
import { PurchaseStatusPill } from '@/components/inventory/purchase-status';
import { CancelPurchaseButton, ReceivePurchaseForm } from '@/components/inventory/stock-actions';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default async function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  let detail;
  try {
    detail = await getPurchaseDetail(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { purchase, lines, receivedValue, receipts } = detail;
  const receivable = ['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED'].includes(purchase.status);
  const canReceive =
    receivable && hasPermission(user, 'purchase.receive', { branchId: purchase.branchId });
  const nothingReceived = lines.every((line) => line.receivedMilli === 0);
  const canEdit =
    purchase.status === 'DRAFT' &&
    hasPermission(user, 'purchase.create', { branchId: purchase.branchId });

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link
            href="/inventory/purchases"
            className="tracking-normal normal-case hover:text-foreground"
          >
            ← Purchases
          </Link>
        }
        title={
          <>
            {purchase.purchaseNumber}
            <PurchaseStatusPill status={purchase.status} />
          </>
        }
        description={
          <>
            <Link
              href={`/inventory/suppliers/${purchase.supplier.id}`}
              className="font-medium text-foreground hover:underline"
            >
              {purchase.supplier.name}
            </Link>
            {purchase.supplierInvoiceNumber
              ? ` · supplier invoice ${purchase.supplierInvoiceNumber}`
              : ''}
            {purchase.supplierInvoiceDate
              ? ` · ${formatCalendarDate(purchase.supplierInvoiceDate)}`
              : ''}
          </>
        }
        actions={
          <>
            {canEdit ? (
              <LinkButton
                href={`/inventory/purchases/${purchase.id}/edit`}
                variant="outline"
                size="lg"
              >
                <Pencil />
                Edit draft
              </LinkButton>
            ) : null}
            {canEdit && nothingReceived ? (
              <CancelPurchaseButton
                purchaseId={purchase.id}
                purchaseNumber={purchase.purchaseNumber}
              />
            ) : null}
          </>
        }
      />

      <Grid className="sm:grid-cols-3">
        <Panel>
          <p className="text-sm text-muted-foreground">Purchase total</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {purchase.totalAmount ? formatMoney(purchase.totalAmount) : '—'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatMoney(purchase.subtotal ?? 0)} + VAT {formatMoney(purchase.taxAmount ?? 0)}
          </p>
        </Panel>
        <Panel>
          <p className="text-sm text-muted-foreground">Received so far</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{formatMoney(receivedValue)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Cost + VAT of quantities received</p>
        </Panel>
        <Panel>
          <p className="text-sm text-muted-foreground">Entered</p>
          <p className="mt-2 text-sm">
            {formatDateTime(purchase.createdAt)} by {purchase.createdBy.fullName}
          </p>
          {purchase.receivedAt ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Last received {formatDateTime(purchase.receivedAt)}
              {purchase.receivedBy ? ` by ${purchase.receivedBy.fullName}` : ''}
            </p>
          ) : null}
        </Panel>
      </Grid>

      {canReceive ? (
        <Section
          title="Receive stock"
          description="Check the quantities against what actually arrived. Anything not received now stays open on the purchase."
        >
          <Panel className="max-w-4xl">
            <ReceivePurchaseForm
              // Remount after each receipt so every line defaults to what is still outstanding.
              key={lines.map((line) => line.receivedMilli).join(':')}
              purchaseId={purchase.id}
              lines={lines.map((line) => ({
                id: line.id,
                sku: line.part.sku,
                name: line.part.name,
                unit: line.part.unitOfMeasure,
                orderedMilli: line.orderedMilli,
                receivedMilli: line.receivedMilli,
                outstandingMilli: line.outstandingMilli,
              }))}
            />
          </Panel>
        </Section>
      ) : null}

      <Section title="Lines">
        <Panel padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Part</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Unit cost</TableHead>
                  <TableHead className="text-right">VAT</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>
                      <Link
                        href={`/inventory/parts/${line.part.id}`}
                        className="font-medium hover:underline"
                      >
                        {line.part.name}
                      </Link>
                      <span className="block font-mono text-xs text-muted-foreground">
                        {line.part.sku}
                      </span>
                      {line.costDiffers ? (
                        <span className="text-xs text-warning">
                          Catalogue cost is {formatMoney(line.part.defaultCostPrice!)} — not changed
                          by this purchase
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMilli(line.orderedMilli)} {line.part.unitOfMeasure}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="tabular-nums">{formatMilli(line.receivedMilli)}</span>
                      {line.outstandingMilli > 0 && line.receivedMilli > 0 ? (
                        <StatusPill tone="warning" className="ml-2">
                          {formatMilli(line.outstandingMilli)} to come
                        </StatusPill>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(line.unitCost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.amounts.taxAmount}{' '}
                      <span className="text-xs text-muted-foreground">
                        ({Number(line.taxRate)}%)
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatMoney(line.amounts.lineTotal)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <dl className="ml-auto grid max-w-xs grid-cols-2 gap-y-1.5 border-t border-border p-4 text-sm sm:p-6">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="text-right tabular-nums">{formatMoney(purchase.subtotal ?? 0)}</dd>
            <dt className="text-muted-foreground">VAT</dt>
            <dd className="text-right tabular-nums">{formatMoney(purchase.taxAmount ?? 0)}</dd>
            <dt className="font-semibold">Total</dt>
            <dd className="text-right font-semibold tabular-nums">
              {formatMoney(purchase.totalAmount ?? 0)}
            </dd>
          </dl>
        </Panel>
      </Section>

      <Section
        title="Stock received"
        description="The stock-history entries this purchase created."
      >
        {receipts.length === 0 ? (
          <EmptyState
            variant="inline"
            icon={PackageCheck}
            title="Nothing received yet"
            description="Stock doesn't change until the purchase is received."
          />
        ) : (
          <Panel padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>When</TableHead>
                    <TableHead>Part</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receipts.map((receipt) => (
                    <TableRow key={receipt.id}>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {formatDateTime(receipt.createdAt)}
                      </TableCell>
                      <TableCell>
                        {receipt.name}{' '}
                        <span className="font-mono text-xs text-muted-foreground">
                          {receipt.sku}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-semibold text-success tabular-nums">
                        +{formatMilli(signedToMilli(receipt.quantity))}
                      </TableCell>
                      <TableCell>{receipt.performedBy?.fullName ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Panel>
        )}
      </Section>

      {purchase.notes ? (
        <Section title="Notes">
          <p className="text-sm whitespace-pre-line">{purchase.notes}</p>
        </Section>
      ) : null}
    </Stack>
  );
}
