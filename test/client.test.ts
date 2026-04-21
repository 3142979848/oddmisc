import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UmamiClient, createUmamiClient } from '../src/modules/umami/client';
import { UmamiUrlError } from '../src/errors';

const SHARE_URL = 'https://umami.example.com/share/abc123';

describe('UmamiClient', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('throws UmamiUrlError when shareUrl is missing', () => {
    expect(() => new UmamiClient({ shareUrl: '' as unknown as string })).toThrow(UmamiUrlError);
  });

  it('createUmamiClient returns a UmamiClient instance', () => {
    const client = createUmamiClient({ shareUrl: SHARE_URL });
    expect(client).toBeInstanceOf(UmamiClient);
  });

  it('normalises stats responses that wrap values in { value }', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ websiteId: 'w1', token: 't1' }) } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ pageviews: { value: 11 }, visitors: { value: 22 }, visits: { value: 33 } })
      } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createUmamiClient({ shareUrl: SHARE_URL });
    client.clearCache();
    const result = await client.getSiteStats();
    expect(result).toMatchObject({ pageviews: 11, visitors: 22, visits: 33 });
  });

  it('sends a url filter when calling getPageStatsByUrl', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ websiteId: 'w1', token: 't1' }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ pageviews: 1, visitors: 1, visits: 1 }) } as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = createUmamiClient({ shareUrl: SHARE_URL });
    client.clearCache();
    await client.getPageStatsByUrl('https://site.example/page');

    const statsCall = fetchMock.mock.calls[1][0] as string;
    expect(statsCall).toContain('url=https%3A%2F%2Fsite.example%2Fpage');
  });
});
