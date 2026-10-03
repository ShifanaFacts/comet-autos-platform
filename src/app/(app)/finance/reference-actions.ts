'use server';

import { requireUser } from '@/lib/auth/authorize';
import { findReferenceMatches, type ReferenceMatch } from '@/lib/finance/reference-matches';

/** Live entries already carrying this payment reference — a warning, never a refusal. */
export async function checkReferenceAction(
  reference: string,
  exceptExpenseId?: string,
): Promise<ReferenceMatch[]> {
  const user = await requireUser();
  return findReferenceMatches(user, reference, exceptExpenseId);
}
