import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/authorize';
import { searchVehicles } from '@/lib/customers/search';
import { OPEN_JOB_STATUSES } from '@/lib/workshop/check-in';

/** A vehicle as the front desk needs to see it: owner, last mileage, and whether it's already in. Serializable. */
export interface VehicleSummary {
  vehicleId: string;
  plateNumber: string;
  plateEmirate: string | null;
  make: string;
  model: string;
  year: number | null;
  vin: string | null;
  lastMileage: number | null;
  customer: { id: string; name: string; phone: string };
  openJob: { id: string; jobNumber: string } | null;
  openAppointment: { id: string; scheduledAt: string; notes: string | null } | null;
}

export async function getVehicleSummaries(organizationId: string, vehicleIds: string[]): Promise<VehicleSummary[]> {
  if (vehicleIds.length === 0) return [];
  const vehicles = await prisma.vehicle.findMany({
    where: { organizationId, id: { in: vehicleIds }, isActive: true },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      jobCards: {
        where: { status: { in: OPEN_JOB_STATUSES } },
        select: { id: true, jobNumber: true },
        take: 1,
      },
      appointments: {
        where: { status: { in: ['SCHEDULED', 'CONFIRMED'] } },
        orderBy: { scheduledAt: 'asc' },
        select: { id: true, scheduledAt: true, notes: true },
        take: 1,
      },
    },
  });
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  return vehicleIds
    .map((id) => byId.get(id))
    .filter((v) => v !== undefined)
    .map((v) => ({
      vehicleId: v.id,
      plateNumber: v.plateNumber,
      plateEmirate: v.plateEmirate,
      make: v.make,
      model: v.model,
      year: v.year,
      vin: v.vin,
      lastMileage: v.lastMileage,
      customer: v.customer,
      openJob: v.jobCards[0] ?? null,
      openAppointment: v.appointments[0]
        ? {
            id: v.appointments[0].id,
            scheduledAt: v.appointments[0].scheduledAt.toISOString(),
            notes: v.appointments[0].notes,
          }
        : null,
    }));
}

export async function searchVehicleSummaries(user: AuthenticatedUser, query: string): Promise<VehicleSummary[]> {
  requirePermission(user, 'vehicle.view');
  const vehicles = await searchVehicles(user.organizationId, query, 12);
  return getVehicleSummaries(
    user.organizationId,
    vehicles.map((v) => v.id),
  );
}
