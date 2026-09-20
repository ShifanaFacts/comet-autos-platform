'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth/authorize';
import { runAction } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { formDataToObject } from '@/lib/form-data';
import { claimRequestKey, settleRequestKey } from '@/lib/request-keys';
import {
  createCustomer,
  findCustomersByPhone,
  updateCustomer,
  type CustomerInput,
} from '@/lib/customers/service';
import { createVehicle, updateVehicle, type VehicleInput } from '@/lib/vehicles/service';

// Shape is validated by the services' zod schemas; missing fields become field errors there.
const asCustomer = (formData: FormData) => formDataToObject(formData) as unknown as CustomerInput;
const asVehicle = (input: Record<string, string>) => input as unknown as VehicleInput;

const fail = (result: ActionResult<unknown>): ActionResult => ({
  ok: false,
  error: result.error,
  fieldErrors: result.fieldErrors,
});

export async function createCustomerAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const input = formDataToObject(formData);
  const result = await runAction(() =>
    prisma.$transaction(async (tx) => {
      await claimRequestKey(tx, user, input, 'customer.create');
      const customer = await createCustomer(tx, user, asCustomer(formData));
      await settleRequestKey(tx, user, input, customer.id);
      return customer;
    }),
  );
  const customerId = result.data?.id ?? (result.duplicate ? result.duplicateOf : null);
  if (!result.ok || !customerId) return fail(result);
  revalidatePath('/customers');
  redirect(`/customers/${customerId}/vehicles/new?new=1`);
}

export async function updateCustomerAction(
  customerId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => updateCustomer(user, customerId, asCustomer(formData)));
  if (!result.ok) return fail(result);
  revalidatePath('/customers');
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}`);
}

/** Warns (never blocks) when the mobile number already belongs to another customer. */
export async function checkDuplicatePhoneAction(phone: string, excludeCustomerId?: string) {
  const user = await requireUser();
  try {
    return await findCustomersByPhone(user, phone, excludeCustomerId);
  } catch {
    return [];
  }
}

export async function createVehicleAction(
  customerId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const input = formDataToObject(formData);
  const result = await runAction(() =>
    prisma.$transaction(async (tx) => {
      await claimRequestKey(tx, user, input, 'vehicle.create');
      const vehicle = await createVehicle(tx, user, customerId, asVehicle(input));
      await settleRequestKey(tx, user, input, vehicle.id);
      return vehicle;
    }),
  );
  const vehicleId = result.data?.id ?? (result.duplicate ? result.duplicateOf : null);
  if (!result.ok || !vehicleId) return fail(result);
  revalidatePath(`/customers/${customerId}`);
  revalidatePath('/vehicles');
  redirect(input.next === 'check-in' ? `/check-in?vehicle=${vehicleId}` : `/vehicles/${vehicleId}`);
}

export async function updateVehicleAction(
  vehicleId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() =>
    updateVehicle(user, vehicleId, asVehicle(formDataToObject(formData))),
  );
  if (!result.ok) return fail(result);
  revalidatePath('/vehicles');
  revalidatePath(`/vehicles/${vehicleId}`);
  redirect(`/vehicles/${vehicleId}`);
}
