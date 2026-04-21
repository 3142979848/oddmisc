import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UmamiAPI } from '../src/modules/umami/api';
import { CacheManager } from '../src/utils/umami/cache';
import { UmamiAuthError, UmamiNetworkError } from '../src/errors';

const BASE = 'https://umami.example.com/api';
const SHARE_ID = 'abc123';

function mockFetchOk(body: unknown) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body
  } as unknown as Response));
}

describe('UmamiAPI.getStats', () => {
  let api: UmamiAPI;
  let cache: CacheManager;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    cache = new CacheManager('api-test', 3600000);
    cache.clear();
    api = new UmamiAPI(cache);
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('forwards the path query parameter to the stats endpoint', async () => {
    const fetchMock = vi.fn()
      // share data
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ websiteId: 'w1', token: 't1' }) } as unknown as Response)
      // stats
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ pageviews: 1, visitors: 2, visits: 3 }) } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await api.getStats(BASE, SHARE_ID, { path: 'eq./about' });

    const statsCall = fetchMock.mock.calls[1][0] as string;
    expect(statsCall).toContain('/websites/w1/stats?');
    expect(statsCall).toContain('path=eq.%2Fabout');
  });

  it('forwards the url query parameter to the stats endpoint', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ websiteId: 'w1', token: 't1' }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ pageviews: 0, visitors: 0, visits: 0 }) } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await api.getStats(BASE, SHARE_ID, { url: 'https://site.example/page' });

    const statsCall = fetchMock.mock.calls[1][0] as string;
    expect(statsCall).toContain('url=https%3A%2F%2Fsite.example%2Fpage');
  });

  it('returns cached response on the second call without calling fetch again', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ websiteId: 'w1', token: 't1' }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ pageviews: 5, visitors: 6, visits: 7 }) } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const first = await api.getStats(BASE, SHARE_ID, { path: 'eq./a' });
    expect(first._fromCache).toBeUndefined();

    const second = await api.getStats(BASE, SHARE_ID, { path: 'eq./a' });
    expect(second._fromCache).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws UmamiAuthError on 401 responses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ websiteId: 'w1', token: 't1' }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(api.getStats(BASE, SHARE_ID, {})).rejects.toBeInstanceOf(UmamiAuthError);
  });

  it('throws UmamiNetworkError on other non-ok stats responses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ websiteId: 'w1', token: 't1' }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(api.getStats(BASE, SHARE_ID, {})).rejects.toBeInstanceOf(UmamiNetworkError);
  });

  it('retries share data fetch after a prior failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ websiteId: 'w1', token: 't1' }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ pageviews: 1, visitors: 1, visits: 1 }) } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(api.getStats(BASE, SHARE_ID, {})).rejects.toBeInstanceOf(UmamiNetworkError);
    const result = await api.getStats(BASE, SHARE_ID, {});
    expect(result.pageviews).toBe(1);
  });
});
