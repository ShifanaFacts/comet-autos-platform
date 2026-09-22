'use server';

import { requireUser } from '@/lib/auth/authorize';
import { searchCustomerOptions, type CustomerOption } from '@/lib/customers/picker';

/** Counter lookup by customer name, mobile, registration or VIN, with each customer's vehicles. */
export async function searchCustomersAction(query: string): Promise<CustomerOption[]> {
  const user = await requireUser();
  if (query.trim().length < 2) return [];
  try {
    return await searchCustomerOptions(user, query);
  } catch {
    return [];
  }
}
