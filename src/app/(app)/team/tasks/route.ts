import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth/session';
import { createTasks } from '@/lib/team/tasks';
import {
  failure,
  filesOf,
  interrupted,
  readForm,
  refuseCrossSite,
  sessionEnded,
  text,
} from '@/lib/team/multipart';

/** Creates a task (or one per chosen person), with its photos and voice note. */
export async function POST(request: NextRequest) {
  const refused = refuseCrossSite(request);
  if (refused) return refused;
  const user = await getCurrentUser();
  if (!user) return sessionEnded();
  const form = await readForm(request);
  if (!form) return interrupted();

  try {
    const created = await createTasks(
      user,
      {
        title: text(form, 'title'),
        details: text(form, 'details'),
        language: text(form, 'language'),
        assigneeIds: form.getAll('assigneeIds').filter((value) => typeof value === 'string'),
        dueDate: text(form, 'dueDate'),
        priority: text(form, 'priority') || undefined,
        jobCardId: text(form, 'jobCardId'),
        requestKey: text(form, 'requestKey'),
      },
      await filesOf(form),
    );
    revalidatePath('/my-work');
    revalidatePath('/team');
    return NextResponse.json({ ok: true, ids: created.map((task) => task.id) });
  } catch (error) {
    return failure(error);
  }
}
