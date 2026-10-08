import type { NextRequest } from 'next/server';
import { getPaymentVoucherDocument } from '@/lib/documents/payment-voucher';
import { staffPdf } from '@/lib/documents/http';

export async function GET(
  request: NextRequest,
  ctx: RouteContext<'/documents/payment-voucher/[id]'>,
) {
  const { id } = await ctx.params;
  return staffPdf(request, (user) => getPaymentVoucherDocument(user, id));
}
