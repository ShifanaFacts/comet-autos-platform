import type { NextRequest } from 'next/server';
import { getReceiptDocumentForLink } from '@/lib/documents/build';
import { customerPdf } from '@/lib/documents/http';

export async function GET(
  request: NextRequest,
  ctx: RouteContext<'/customer/invoice/[token]/receipts/[number]/pdf'>,
) {
  const { token, number } = await ctx.params;
  return customerPdf(request, 'INVOICE', token, (organizationId, invoiceId) =>
    getReceiptDocumentForLink(organizationId, invoiceId, decodeURIComponent(number)),
  );
}
