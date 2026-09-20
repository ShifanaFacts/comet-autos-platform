'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/authorize';
import { runAction } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { formDataToObject } from '@/lib/form-data';
import { prisma } from '@/lib/prisma';
import { checkInVehicle, type CheckInResult } from '@/lib/workshop/check-in';

export async function checkInAction(
  _prev: ActionResult<CheckInResult>,
  formData: FormData,
): Promise<ActionResult<CheckInResult>> {
  const user = await requireUser();
  const input = formDataToObject(formData);
  const visit = {
    complaint: input.complaint,
    mileage: input.mileage,
    appointmentId: input.appointmentId,
  };

  const result = await runAction(() =>
    input.mode === 'new'
      ? checkInVehicle(user, {
          mode: 'new',
          customer: { name: input.name, phone: input.phone, email: input.email },
          vehicle: {
            plateNumber: input.plateNumber,
            plateEmirate: input.plateEmirate,
            vin: input.vin,
            make: input.make,
            model: input.model,
            year: input.year,
          },
          visit,
          requestKey: input.requestKey,
        })
      : checkInVehicle(user, {
          mode: 'existing',
          vehicleId: input.vehicleId ?? '',
          visit,
          requestKey: input.requestKey,
        }),
  );

  if (!result.ok) return { ok: false, error: result.error, fieldErrors: result.fieldErrors };
  if (result.duplicate) {
    // The same check-in was submitted twice: show the job the first submission opened.
    const job = result.duplicateOf
      ? await prisma.jobCard.findFirst({
          where: { id: result.duplicateOf, organizationId: user.organizationId },
          select: { id: true, jobNumber: true },
        })
      : null;
    return job
      ? { ok: true, data: { jobCardId: job.id, jobNumber: job.jobNumber } }
      : { ok: false, error: 'This check-in was already saved. Open Job Cards to find it.' };
  }
  revalidatePath('/');
  revalidatePath('/job-cards');
  revalidatePath('/appointments');
  return result;
}
