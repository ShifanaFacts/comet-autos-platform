import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth/session';
import { addTaskUpdate } from '@/lib/team/tasks';
import {
  failure,
  filesOf,
  interrupted,
  readForm,
  refuseCrossSite,
  sessionEnded,
  text,
} from '@/lib/team/multipart';

/** Adds a note — text, photos, a voice note — to a task. */
export async function POST(request: NextRequest, ctx: RouteContext<'/team/tasks/[id]/notes'>) {
  const refused = refuseCrossSite(request);
  if (refused) return refused;
  const user = await getCurrentUser();
  if (!user) return sessionEnded();
  const { id } = await ctx.params;
  const form = await readForm(request);
  if (!form) return interrupted();

  try {
    await addTaskUpdate(
      user,
      id,
      {
        body: text(form, 'body'),
        language: text(form, 'language'),
        requestKey: text(form, 'requestKey'),
      },
      await filesOf(form),
    );
    revalidatePath(`/team/tasks/${id}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
