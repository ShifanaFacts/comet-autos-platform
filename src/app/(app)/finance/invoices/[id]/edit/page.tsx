import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser, requirePermission } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { getInvoiceDetail } from '@/lib/billing/invoice';
import { invoiceEditBlocker } from '@/lib/billing/invoice-changes';
import { editableBill, editableLine } from '@/lib/billing/editable-lines';
import { resolveDefaultVatRate } from '@/lib/tax';
import { formatCalendarDate } from '@/lib/format';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { EditInvoiceForm } from './edit-invoice-form';

/** Correcting the lines of an invoice nobody has paid yet. */
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
  requirePermission(user, 'invoice.create', { branchId: invoice.branchId });
  const blocker = invoiceEditBlocker(invoice);
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
      <Panel className="max-w-5xl">
        {blocker ? (
          <p className="text-sm text-muted-foreground">{blocker}</p>
        ) : (
          <EditInvoiceForm
            invoiceId={invoice.id}
            defaultVatRate={defaultVatRate}
            notes={invoice.notes ?? ''}
            issueDate={invoice.issueDate.toISOString().slice(0, 10)}
            dueDate={(invoice.dueDate ?? invoice.issueDate).toISOString().slice(0, 10)}
            customerReference={invoice.customerReference ?? ''}
            bill={editableBill(invoice)}
            lines={invoice.items.map((item, index) => editableLine(item, `existing-${index}`, '0'))}
          />
        )}
      </Panel>
    </Stack>
  );
}
