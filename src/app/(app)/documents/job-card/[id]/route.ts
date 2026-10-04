import type { NextRequest } from 'next/server';
import { getJobCardDocument } from '@/lib/documents/build';
import { staffPdf } from '@/lib/documents/http';

export async function GET(request: NextRequest, ctx: RouteContext<'/documents/job-card/[id]'>) {
  const { id } = await ctx.params;
  return staffPdf(request, (user) => getJobCardDocument(user, id));
}
