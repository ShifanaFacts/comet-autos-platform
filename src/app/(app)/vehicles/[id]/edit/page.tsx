import { notFound } from 'next/navigation';
import { requireUser, hasPermission } from '@/lib/auth/authorize';
import { AccessDenied } from '@/components/shared/access-denied';
import { NotFoundError } from '@/lib/errors';
import { getVehicleDetail } from '@/lib/vehicles/service';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { VehiclePlate } from '@/components/shared/vehicle-plate';
import { VehicleForm } from '@/components/workshop/vehicle-form';
import { updateVehicleAction } from '../../../customers/actions';

export default async function EditVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (
    !hasPermission(
      user,
      'vehicle.edit',
      user.primaryBranchId ? { branchId: user.primaryBranchId } : undefined,
    )
  ) {
    return <AccessDenied what="editing vehicles" />;
  }
  const { id } = await params;
  let vehicle;
  try {
    vehicle = await getVehicleDetail(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow="Vehicles"
        leading={
          <VehiclePlate plateNumber={vehicle.plateNumber} className="px-3 py-1.5 text-base" />
        }
        title={`Edit ${vehicle.make} ${vehicle.model}`}
        description={`Owner: ${vehicle.customer.name}. Mileage is updated automatically at each check-in.`}
      />
      <Panel className="w-full max-w-2xl sm:p-8">
        <VehicleForm
          action={updateVehicleAction.bind(null, vehicle.id)}
          initial={vehicle}
          submitLabel="Save changes"
          cancelHref={`/vehicles/${vehicle.id}`}
        />
      </Panel>
    </Stack>
  );
}
