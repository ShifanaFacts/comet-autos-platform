import type { NextRequest } from 'next/server';
import { getInvoiceDocument } from '@/lib/documents/build';
import { staffPdf } from '@/lib/documents/http';

export async function GET(request: NextRequest, ctx: RouteContext<'/documents/invoice/[id]'>) {
  const { id } = await ctx.params;
  return staffPdf(request, (user) => getInvoiceDocument(user, id));
}
