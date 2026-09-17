import { notFound } from 'next/navigation';
import { requireUser, requirePermission } from '@/lib/auth/authorize';
import { NotFoundError } from '@/lib/errors';
import { getCustomerDetail } from '@/lib/customers/service';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { VehicleForm } from '@/components/workshop/vehicle-form';
import { createVehicleAction } from '../../../actions';

export default async function NewVehiclePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const user = await requireUser();
  requirePermission(user, 'vehicle.create');
  const { id } = await params;
  const isNewCustomer = (await searchParams).new === '1';
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
      <PageHeader
        eyebrow={isNewCustomer ? 'New customer · step 2 of 2' : 'Customers'}
        title="Add vehicle"
        description={
          <>
            Owner: <span className="font-medium text-foreground">{customer.name}</span> · {customer.phone}
          </>
        }
      />
      <Panel className="w-full max-w-2xl sm:p-8">
        <VehicleForm
          action={createVehicleAction.bind(null, customer.id)}
          submitLabel="Save vehicle"
          cancelHref={`/customers/${customer.id}`}
          offerCheckIn
        />
      </Panel>
    </Stack>
  );
}
