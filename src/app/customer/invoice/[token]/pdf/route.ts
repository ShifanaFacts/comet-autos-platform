import type { NextRequest } from 'next/server';
import { getInvoiceDocumentForLink } from '@/lib/documents/build';
import { customerPdf } from '@/lib/documents/http';

export async function GET(
  request: NextRequest,
  ctx: RouteContext<'/customer/invoice/[token]/pdf'>,
) {
  const { token } = await ctx.params;
  return customerPdf(
    request,
    'INVOICE',
    token,
    async (organizationId, invoiceId) =>
      (await getInvoiceDocumentForLink(organizationId, invoiceId))?.document ?? null,
  );
}
