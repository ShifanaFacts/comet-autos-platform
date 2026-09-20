import type { NextRequest } from 'next/server';
import { getReceiptDocument } from '@/lib/documents/build';
import { staffPdf } from '@/lib/documents/http';

export async function GET(request: NextRequest, ctx: RouteContext<'/documents/receipt/[id]'>) {
  const { id } = await ctx.params;
  return staffPdf(request, (user) => getReceiptDocument(user, id));
}
