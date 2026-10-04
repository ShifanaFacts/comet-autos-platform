'use server';

import { requireUser } from '@/lib/auth/authorize';
import {
  getCustomerOptions,
  searchCustomerOptions,
  type CustomerOption,
} from '@/lib/customers/picker';

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

/** One customer as the picker shows it — an existing customer chosen from the "new customer" popup. */
export async function getCustomerOptionAction(customerId: string): Promise<CustomerOption | null> {
  const user = await requireUser();
  try {
    return (await getCustomerOptions(user, [customerId]))[0] ?? null;
  } catch {
    return null;
  }
}
