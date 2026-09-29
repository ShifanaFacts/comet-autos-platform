'use server';

import { requireUser } from '@/lib/auth/authorize';
import {
  listCustomerVehicleSummaries,
  searchVehicleSummaries,
  type VehicleSummary,
} from '@/lib/vehicles/summary';

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

/** A customer's other vehicles, to bring in on the same check-in. */
export async function customerVehiclesAction(customerId: string): Promise<VehicleSummary[]> {
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) return [];
  try {
    return await listCustomerVehicleSummaries(user, customerId);
  } catch {
    return [];
  }
}
