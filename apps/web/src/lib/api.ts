export type EventRow = { id: string; action: string; created_at: string };
export type Config = { aiEnabled: boolean; mode: string; maxTestsPerRun: number };

/** Anything that can answer workspace requests: the real API or the in-browser demo. */
export type Backend = { request<T>(path: string, body?: unknown): Promise<T> };

const TIMEOUT_MS = 20000;

export async function httpRequest<T>(path: string, body: unknown, token: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    // A proxy or gateway error page is not JSON; report it instead of a parse failure.
    const data = (await response.json().catch(() => null)) as { message?: string } | null;
    if (!response.ok) throw new Error(data?.message ?? `Request failed (${response.status})`);
    if (data === null) throw new Error('The API returned an unreadable response');
    return data as T;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError')
      throw new Error('The API did not respond in time; check that it is running');
    if (e instanceof TypeError) throw new Error('Could not reach the API; check that it is running');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
