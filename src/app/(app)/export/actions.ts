'use server';

import { requireUser } from '@/lib/auth/authorize';
import { canExport, exportGuide, type ExportGuide } from '@/lib/data-transfer/exports';

/** What an export holds and what each column means, for the panel shown before it downloads. */
export async function exportGuideAction(entity: string): Promise<ExportGuide | null> {
  const user = await requireUser();
  return canExport(user, entity) ? exportGuide(entity) : null;
}
