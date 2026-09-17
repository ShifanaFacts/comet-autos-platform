'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth/authorize';
import { transitionJobStatus } from '@/lib/workshop/job-status';
import type { JobCardStatus } from '@/generated/prisma/enums';

export async function changeJobStatus(jobCardId: string, toStatus: JobCardStatus): Promise<{ error?: string }> {
  const user = await requireUser();

  try {
    await prisma.$transaction((tx) => transitionJobStatus(tx, user, jobCardId, toStatus));
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not change status.' };
  }

  revalidatePath(`/job-cards/${jobCardId}`);
  return {};
}
