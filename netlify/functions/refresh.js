// netlify/functions/refresh.js
// ROLE:
// - Admin-triggered refresh endpoint
// - Snapshot / feed rebuild trigger (signal-based)
// - Cache invalidation hint
// - NO external dependencies (build-safe)

export async function handler(event, context) {
  const now = new Date().toISOString();

  try {
    const method = event.httpMethod || 'GET';
    const source = event.headers?.['x-refresh-source'] || 'manual';

    const refreshSignal = {
      refresh: true,
      snapshot: true,
      feeds: true,
      source,
      at: now
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, max-age=0'
      },
      body: JSON.stringify({
        ok: true,
        action: 'refresh',
        signal: refreshSignal,
        message: 'Refresh signal accepted',
        timestamp: now
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ok: false,
        action: 'refresh',
        error: err?.message || 'Refresh failed',
        timestamp: now
      })
    };
  }
}
