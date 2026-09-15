import { getApiHealth } from '@/lib/api-client';

type ApiStatus = { ok: true; timestamp: string } | { ok: false; error: string };

async function checkApiStatus(): Promise<ApiStatus> {
  try {
    const health = await getApiHealth();
    return { ok: true, timestamp: health.timestamp };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export default async function Home() {
  const apiStatus = await checkApiStatus();

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        padding: '3rem 1.5rem',
        maxWidth: 640,
        margin: '0 auto',
      }}
    >
      <h1>Comet Autos</h1>
      <p>Workshop Management System — foundation build.</p>

      <section
        style={{
          marginTop: '2rem',
          padding: '1rem 1.25rem',
          border: '1px solid #ddd',
          borderRadius: 8,
        }}
      >
        <h2 style={{ marginTop: 0 }}>NestJS API connectivity</h2>
        {apiStatus.ok ? (
          <p>
            Connected — <code>GET /health</code> responded at {apiStatus.timestamp}
          </p>
        ) : (
          <p>
            Could not reach the API: {apiStatus.error}. Make sure it is running (
            <code>npm run dev:api</code>) and <code>API_BASE_URL</code> is set correctly.
          </p>
        )}
      </section>
    </main>
  );
}
