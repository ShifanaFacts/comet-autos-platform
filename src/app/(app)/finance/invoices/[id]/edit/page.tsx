import Link from 'next/link';
import { getTaxCodeOptions } from '@/lib/accounting/tax-codes';
import { getPartCatalog } from '@/lib/inventory/part-options';
import { notFound } from 'next/navigation';
import { hasPermission, requireUser, requirePermission } from '@/lib/auth/authorize';
import { getAccountChoices } from '@/lib/accounting/reports';
import { NotFoundError } from '@/lib/errors';
import { getInvoiceDetail } from '@/lib/billing/invoice';
import { invoiceEditBlocker, settledFils } from '@/lib/billing/invoice-changes';
import { filsToString, toFils } from '@/lib/money';
import { editableBill, editableLine } from '@/lib/billing/editable-lines';
import { resolveDefaultVatRate } from '@/lib/tax';
import { formatCalendarDate, formatMoney } from '@/lib/format';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { jobHasFittedParts, stockHeldByInvoice } from '@/lib/billing/part-lines';
import { EditInvoiceForm } from './edit-invoice-form';

/**
 * Correcting an invoice — unpaid, or already paid in part or in full. What
 * was received stays as it is; the new total may not fall below it.
 */
export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  let invoice;
  try {
    invoice = await getInvoiceDetail(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  requirePermission(user, 'invoice.edit', { branchId: invoice.branchId });
  const blocker = invoiceEditBlocker(invoice);
  const settled = settledFils({ ...invoice, paidFils: toFils(invoice.paidAmount) });
  const defaultVatRate = await resolveDefaultVatRate(user.organizationId);

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow={
          <Link href={`/finance/invoices/${invoice.id}`} className="text-primary hover:underline">
            {invoice.invoiceNumber}
          </Link>
        }
        title="Edit invoice"
        description={`For ${invoice.customer.name} · issued ${formatCalendarDate(invoice.issueDate)}. The number and date stay the same, your workshop and customer details are updated to what is in Settings now, and the change is recorded in the history.`}
      />
      {!blocker && settled > 0 ? (
        <div className="rounded-xl border border-warning/40 bg-warning/5 px-4 py-3 text-sm sm:px-5">
          <p className="font-medium">
            {formatMoney(filsToString(settled))} has already been received for this invoice.
          </p>
          <p className="mt-1 text-muted-foreground">
            The payments stay exactly as they are. The new total can’t be less than this amount — if
            it goes up, the difference becomes due; if it comes back to this amount, the invoice is
            settled. The books are corrected on the invoice’s own date.
          </p>
        </div>
      ) : null}
      <Panel>
        {blocker ? (
          <p className="text-sm text-muted-foreground">{blocker}</p>
        ) : (
          <EditInvoiceForm
            invoiceId={invoice.id}
            defaultVatRate={defaultVatRate}
            taxCodes={await getTaxCodeOptions(user.organizationId, 'sales')}
            catalog={await getPartCatalog(user, { forSale: true })}
            held={await stockHeldByInvoice(user.organizationId, invoice.id)}
            partsFitted={await jobHasFittedParts(user.organizationId, invoice.jobCardId)}
            notes={invoice.notes ?? ''}
            issueDate={invoice.issueDate.toISOString().slice(0, 10)}
            dueDate={(invoice.dueDate ?? invoice.issueDate).toISOString().slice(0, 10)}
            customerReference={invoice.customerReference ?? ''}
            bill={editableBill(invoice)}
            rounding={
              invoice.roundingAdjustment.isZero() ? '' : invoice.roundingAdjustment.toFixed(2)
            }
            incomeAccounts={
              hasPermission(user, 'accounting.view')
                ? (await getAccountChoices(user)).income
                : undefined
            }
            lines={invoice.items.map((item, index) => editableLine(item, `existing-${index}`, '0'))}
          />
        )}
      </Panel>
    </Stack>
  );
}
