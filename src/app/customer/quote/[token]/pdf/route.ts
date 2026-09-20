import type { NextRequest } from 'next/server';
import { getQuotationDocumentForLink } from '@/lib/documents/build';
import { customerPdf } from '@/lib/documents/http';

export async function GET(request: NextRequest, ctx: RouteContext<'/customer/quote/[token]/pdf'>) {
  const { token } = await ctx.params;
  return customerPdf(request, 'ESTIMATE', token, getQuotationDocumentForLink);
}
