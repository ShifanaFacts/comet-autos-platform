'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/authorize';
import { runAction, toClientResult } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { formDataToObject } from '@/lib/form-data';
import { clockIn, clockOut, markAttendance } from '@/lib/hr/attendance';

/*
 * Server actions for attendance. Each re-reads the session and hands to the
 * service — the permission, the organization and branch scope, the one-row-
 * per-day rule and the request key all live there.
 */

function refresh(employeeId?: string) {
  revalidatePath('/hr/attendance');
  if (employeeId) revalidatePath(`/hr/attendance/${employeeId}`);
  revalidatePath('/hr/employees', 'layout');
}

/**
 * The one button a technician taps. The request key is derived from the
 * employee, the day and the direction, so a double tap or a retry on a
 * dropped connection is recognised as the same tap.
 */
export async function clockAction(
  employeeId: string,
  direction: 'IN' | 'OUT',
  date: string,
): Promise<ActionResult> {
  const user = await requireUser();
  const input = { date, requestKey: `attendance-${direction}-${employeeId}-${date}` };
  const result = await runAction(() =>
    direction === 'IN' ? clockIn(user, employeeId, input) : clockOut(user, employeeId, input),
  );
  if (result.ok) refresh(employeeId);
  return toClientResult(result);
}

export async function markAttendanceAction(
  employeeId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() =>
    markAttendance(user, employeeId, formDataToObject(formData)),
  );
  if (result.ok) refresh(employeeId);
  return toClientResult(result);
}
