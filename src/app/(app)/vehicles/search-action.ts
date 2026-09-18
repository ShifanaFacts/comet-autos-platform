'use server';

import { requireUser } from '@/lib/auth/authorize';
import { searchVehicleSummaries, type VehicleSummary } from '@/lib/vehicles/summary';

/** Front-desk lookup: registration, VIN, customer name or mobile → vehicles with owner and workshop state. */
export async function searchVehiclesAction(query: string): Promise<VehicleSummary[]> {
  const user = await requireUser();
  if (query.trim().length < 2) return [];
  try {
    return await searchVehicleSummaries(user, query);
  } catch {
    return [];
  }
}
