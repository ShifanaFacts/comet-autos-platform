import { notFound } from 'next/navigation';
import { requireUser, requirePermission } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { getCustomerDetail } from '@/lib/customers/service';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { CustomerForm } from '@/components/workshop/customer-form';
import { updateCustomerAction } from '../../actions';

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  requirePermission(user, 'customer.edit');
  const { id } = await params;
  let detail;
  try {
    detail = await getCustomerDetail(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { customer } = detail;

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader eyebrow="Customers" title={`Edit ${customer.name}`} description="Contact details used for quotations and invoices." />
      <Panel className="w-full max-w-2xl sm:p-8">
        <CustomerForm
          action={updateCustomerAction.bind(null, customer.id)}
          customerId={customer.id}
          initial={customer}
          submitLabel="Save changes"
          cancelHref={`/customers/${customer.id}`}
        />
      </Panel>
    </Stack>
  );
}
