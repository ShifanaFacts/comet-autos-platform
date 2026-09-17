import { headers } from 'next/headers';

/**
 * The public origin the current request came in on, used to build the
 * customer quotation link. APP_BASE_URL overrides it when the app sits
 * behind a proxy that doesn't forward the original host.
 */
export async function getRequestOrigin(): Promise<string> {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, '');
  const list = await headers();
  const host = list.get('x-forwarded-host') ?? list.get('host') ?? 'localhost:3000';
  const proto = list.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export function customerQuotePath(rawToken: string): string {
  return `/customer/quote/${rawToken}`;
}
