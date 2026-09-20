import Link from 'next/link';
import { Receipt } from 'lucide-react';
import { hasPermission, requireUser } from '@/lib/auth/authorize';
import { AccessDenied } from '@/components/shared/access-denied';
import { listInvoices } from '@/lib/billing/lists';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { filsToString, toFils } from '@/lib/money';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusPill } from '@/components/shared/status-pill';
import { VehiclePlate } from '@/components/shared/vehicle-plate';
import { ListFilters } from '@/components/inventory/list-filters';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const STATE = {
  UNPAID: { label: 'Unpaid', tone: 'warning' },
  PARTIALLY_PAID: { label: 'Partially paid', tone: 'warning' },
  PAID: { label: 'Paid', tone: 'success' },
} as const;

export const metadata = { title: 'Invoices — Comet Autos' };

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const user = await requireUser();
  if (
    !hasPermission(
      user,
      'invoice.view',
      user.primaryBranchId ? { branchId: user.primaryBranchId } : undefined,
    )
  ) {
    return <AccessDenied what="invoices" />;
  }
  const params = await searchParams;
  const { invoices, status } = await listInvoices(user, params);
  const owed = filsToString(
    invoices.reduce((sum, invoice) => sum + toFils(invoice.balance.balance), 0),
  );

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow="Finance"
        title="Invoices"
        description="Tax invoices issued for completed jobs. Invoices are created from the job card once the work has passed its quality check."
      />
      <Stack gap="base">
        <ListFilters
          placeholder="Invoice, customer, job or registration"
          selects={[
            {
              name: 'status',
              label: 'Payment',
              options: [
                { value: '', label: 'All invoices' },
                { value: 'unpaid', label: 'Unpaid / part paid' },
                { value: 'paid', label: 'Paid' },
              ],
            },
          ]}
        />
        {status === 'unpaid' && invoices.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            Customers owe{' '}
            <span className="font-semibold text-warning tabular-nums">{formatMoney(owed)}</span> on{' '}
            {invoices.length} invoice
            {invoices.length === 1 ? '' : 's'}.
          </p>
        ) : null}
        {invoices.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={params.q || status ? 'No invoices match' : 'No invoices yet'}
            description={
              params.q || status
                ? 'Try another search, or clear the filters.'
                : 'Invoices appear here once a job is invoiced from its job card.'
            }
          />
        ) : (
          <Panel padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Invoice</TableHead>
                    <TableHead className="hidden md:table-cell">Customer · vehicle</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => {
                    const state = STATE[invoice.balance.state];
                    return (
                      <TableRow key={invoice.id} className="relative">
                        <TableCell>
                          <Link
                            href={
                              invoice.jobCard
                                ? `/job-cards/${invoice.jobCard.id}#invoice`
                                : `/documents/invoice/${invoice.id}`
                            }
                            className="font-semibold after:absolute after:inset-0 hover:underline"
                          >
                            {invoice.invoiceNumber}
                          </Link>
                          <span className="block text-xs text-muted-foreground">
                            {formatCalendarDate(invoice.issueDate)}
                            {invoice.jobCard ? ` · ${invoice.jobCard.jobNumber}` : ''}
                          </span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <span className="flex items-center gap-3">
                            {invoice.jobCard ? (
                              <VehiclePlate
                                plateNumber={invoice.jobCard.vehicle.plateNumber}
                                className="px-2 py-0.5 text-xs"
                              />
                            ) : null}
                            <span className="min-w-0">
                              <span className="block truncate">{invoice.customerName ?? '—'}</span>
                              {invoice.jobCard ? (
                                <span className="block truncate text-xs text-muted-foreground">
                                  {invoice.jobCard.vehicle.make} {invoice.jobCard.vehicle.model}
                                </span>
                              ) : null}
                            </span>
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(invoice.balance.total)}
                        </TableCell>
                        <TableCell
                          className={
                            invoice.balance.balance === '0.00'
                              ? 'text-right text-muted-foreground tabular-nums'
                              : 'text-right font-semibold tabular-nums'
                          }
                        >
                          {formatMoney(invoice.balance.balance)}
                        </TableCell>
                        <TableCell>
                          <StatusPill tone={state.tone}>{state.label}</StatusPill>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Panel>
        )}
      </Stack>
    </Stack>
  );
}
