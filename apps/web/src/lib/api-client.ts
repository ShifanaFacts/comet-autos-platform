// Server-only HTTP client for talking to the NestJS API. Deliberately not
// prefixed with NEXT_PUBLIC_: this module must only ever run on the server
// (Server Components / Server Actions), never ship the API base URL to the
// browser bundle.
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3001';

export interface HealthResponse {
  status: 'ok';
  timestamp: string;
}

export async function getApiHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_BASE_URL}/health`, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`API health check failed with status ${response.status}`);
  }

  return (await response.json()) as HealthResponse;
}
