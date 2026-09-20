import type { NextRequest } from 'next/server';
import { getQuotationDocument } from '@/lib/documents/build';
import { staffPdf } from '@/lib/documents/http';

export async function GET(request: NextRequest, ctx: RouteContext<'/documents/quotation/[id]'>) {
  const { id } = await ctx.params;
  return staffPdf(request, (user) => getQuotationDocument(user, id));
}
