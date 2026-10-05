'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/authorize';
import { runAction, toClientResult } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { formDataToObject } from '@/lib/form-data';
import { reportLeftAt, selfClock } from '@/lib/hr/self-attendance';

function refresh() {
  // The check-in pill sits in the top bar, around every page.
  revalidatePath('/', 'layout');
  revalidatePath('/my-work');
  revalidatePath('/hr/attendance', 'layout');
  revalidatePath('/team');
  revalidatePath('/live');
  revalidatePath('/');
}

/**
 * Checks the signed-in person in or out from where their phone is. The
 * request key is fixed per person, day and direction, so a double tap or a
 * retry on a dropped connection is the same tap.
 */
export async function selfClockAction(
  direction: 'IN' | 'OUT',
  position: { latitude: number; longitude: number; accuracy: number },
  dayKey: string,
  /** Checking in after a day left open: when they left that day (HH:MM). */
  previousLeftAt?: string,
): Promise<ActionResult<{ closed: string[] }>> {
  const user = await requireUser();
  const result = await runAction(async () => {
    const outcome = await selfClock(user, direction, {
      ...position,
      previousLeftAt,
      requestKey: `self-${direction}-${user.id}-${dayKey}`.slice(0, 64),
    });
    return { closed: outcome.closed };
  });
  if (result.ok) refresh();
  return { ...toClientResult(result), data: result.data };
}

/** "I forgot to check out — I left at …". */
export async function reportLeftAtAction(
  attendanceId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const result = await runAction(() => reportLeftAt(user, attendanceId, formDataToObject(formData)));
  if (result.ok) refresh();
  return toClientResult(result);
}
