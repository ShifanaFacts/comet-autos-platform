import { requireUser, requirePermission } from '@/lib/auth/authorize';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { CustomerForm } from '@/components/workshop/customer-form';
import { createCustomerAction } from '../actions';

export default async function NewCustomerPage() {
  const user = await requireUser();
  requirePermission(user, 'customer.create');

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow="Customers"
        title="New customer"
        description="Step 1 of 2 — the customer's details. Next you'll add their vehicle."
      />
      <Panel className="w-full max-w-2xl sm:p-8">
        <CustomerForm action={createCustomerAction} submitLabel="Save & add vehicle" cancelHref="/customers" />
      </Panel>
    </Stack>
  );
}
