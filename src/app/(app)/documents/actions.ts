'use server';

import { requireUser } from '@/lib/auth/authorize';
import { runAction } from '@/lib/action';
import type { ActionResult } from '@/lib/errors';
import { createShareLink, shareResult } from '@/lib/customer-access/share';
import { getRequestOrigin } from '@/lib/request-origin';

export interface ShareActionData {
  link: string;
  message: string;
  whatsappUrl: string;
}

/**
 * Issues a secure customer link for a quotation, invoice or receipt and
 * returns the prepared WhatsApp message. The target carries only the
 * document kind and id; everything else is read and checked on the server.
 */
export async function shareDocumentAction(target: unknown): Promise<ActionResult<ShareActionData>> {
  const user = await requireUser();
  const origin = await getRequestOrigin();
  return runAction(async () => shareResult(await createShareLink(user, target), origin));
}
