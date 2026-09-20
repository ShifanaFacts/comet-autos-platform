import { requireUser, hasPermission } from '@/lib/auth/authorize';
import { AccessDenied } from '@/components/shared/access-denied';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { CustomerForm } from '@/components/workshop/customer-form';
import { createCustomerAction } from '../actions';

export default async function NewCustomerPage() {
  const user = await requireUser();
  if (
    !hasPermission(
      user,
      'customer.create',
      user.primaryBranchId ? { branchId: user.primaryBranchId } : undefined,
    )
  ) {
    return <AccessDenied what="adding customers" />;
  }

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow="Customers"
        title="New customer"
        description="Step 1 of 2 — the customer's details. Next you'll add their vehicle."
      />
      <Panel className="w-full max-w-2xl sm:p-8">
        <CustomerForm
          action={createCustomerAction}
          submitLabel="Save & add vehicle"
          cancelHref="/customers"
        />
      </Panel>
    </Stack>
  );
}
