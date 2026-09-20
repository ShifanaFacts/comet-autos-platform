import { requireUser, hasPermission } from '@/lib/auth/authorize';
import { AccessDenied } from '@/components/shared/access-denied';
import { getVehicleSummaries, type VehicleSummary } from '@/lib/vehicles/summary';
import { localDateString, toLocalDateTimeInput } from '@/lib/format';
import { PageHeader, Panel, Stack } from '@/components/layout/primitives';
import { AppointmentForm } from './appointment-form';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Next working slot suggestion: tomorrow at 09:00 workshop time. */
function suggestedSlot(): string {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return `${localDateString(tomorrow)}T09:00`;
}

export default async function NewAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{ vehicle?: string }>;
}) {
  const user = await requireUser();
  if (
    !hasPermission(
      user,
      'job_card.create',
      user.primaryBranchId ? { branchId: user.primaryBranchId } : undefined,
    )
  ) {
    return <AccessDenied what="booking appointments" />;
  }
  const { vehicle: vehicleParam } = await searchParams;

  let vehicle: VehicleSummary | null = null;
  if (vehicleParam && UUID.test(vehicleParam)) {
    [vehicle = null] = await getVehicleSummaries(user.organizationId, [vehicleParam]);
  }

  return (
    <Stack gap="2xl" className="animate-in fade-in duration-300">
      <PageHeader
        eyebrow="Appointments"
        title="Book an appointment"
        description="Only what the workshop needs: which vehicle, when, and what the customer wants done."
      />
      <Panel className="w-full max-w-3xl sm:p-8">
        <AppointmentForm
          initialVehicle={vehicle}
          defaultScheduledAt={suggestedSlot()}
          minScheduledAt={toLocalDateTimeInput(new Date())}
        />
      </Panel>
    </Stack>
  );
}
