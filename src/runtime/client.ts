/**
 * 浏览器运行时客户端
 * 注意：此文件会被内联注入到页面，不能有外部依赖
 */

const DEFAULT_TIMEOUT = 10000;

async function fetchWithTimeout(url: string, options?: RequestInit, timeout = DEFAULT_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * cloud.umami.is 以及新版自托管 Umami 对 share token 请求要求此头部，
 * 缺失时所有 `/websites/*` 请求都会返回 401 Unauthorized。
 */
const SHARE_CONTEXT_HEADER = 'x-umami-share-context';
const SHARE_CONTEXT_VALUE = '1';

interface UmamiRuntimeConfig {
  shareUrl: string | false;
}

interface StatsResult {
  pageviews: number;
  visitors: number;
  visits: number;
  bounces?: number;
  totaltime?: number;
  _fromCache?: boolean;
}

interface ShareData {
  websiteId: string;
  token: string;
}

function parseShareUrl(shareUrl: string): { apiBase: string; shareId: string } {
  const url = new URL(shareUrl);
  const pathParts = url.pathname.split('/');
  const shareIndex = pathParts.indexOf('share');

  if (shareIndex === -1 || shareIndex === pathParts.length - 1) {
    throw new Error('无效的分享 URL：未找到 share 路径');
  }

  const shareId = pathParts[shareIndex + 1];

  if (!shareId) {
    throw new Error('无效的分享 URL：缺少分享 ID');
  }

  const pathBeforeShare = pathParts.slice(0, shareIndex).join('/');
  const apiBase = `${url.protocol}//${url.host}${pathBeforeShare}/api`;

  return { apiBase, shareId };
}

class SimpleCache {
  private cache = new Map<string, { value: unknown; timestamp: number }>();
  private storageKey: string;
  private ttl: number;

  constructor(storageKey: string, ttl: number) {
    this.storageKey = storageKey;
    this.ttl = ttl;
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (!stored) return;
      const parsed = JSON.parse(stored) as Record<string, { value: unknown; timestamp: number }>;
      for (const [key, entry] of Object.entries(parsed)) {
        if (entry && typeof entry.timestamp === 'number' && !this.isExpired(entry.timestamp)) {
          this.cache.set(key, entry);
        }
      }
    } catch {}
  }

  private saveToStorage(): void {
    try {
      const obj: Record<string, { value: unknown; timestamp: number }> = {};
      this.cache.forEach((value, key) => {
        obj[key] = value;
      });
      localStorage.setItem(this.storageKey, JSON.stringify(obj));
    } catch {}
  }

  private isExpired(timestamp: number): boolean {
    return Date.now() - timestamp >= this.ttl;
  }

  get(key: string): unknown | null {
    const cached = this.cache.get(key);
    if (cached && !this.isExpired(cached.timestamp)) {
      return cached.value;
    }
    if (cached) {
      this.cache.delete(key);
      this.saveToStorage();
    }
    return null;
  }

  set(key: string, value: unknown): void {
    const entry = { value, timestamp: Date.now() };
    this.cache.set(key, entry);
    this.saveToStorage();
  }

  clear(): void {
    this.cache.clear();
    try {
      localStorage.removeItem(this.storageKey);
    } catch {}
  }
}

class UmamiRuntimeClient {
  private apiBase: string;
  private shareId: string;
  private cache: SimpleCache;
  private shareData: ShareData | null = null;
  private sharePromise: Promise<ShareData> | null = null;

  constructor(config: UmamiRuntimeConfig) {
    if (!config.shareUrl) {
      throw new Error('shareUrl 是必需参数');
    }
    const { apiBase, shareId } = parseShareUrl(config.shareUrl);
    this.apiBase = apiBase;
    this.shareId = shareId;
    this.cache = new SimpleCache(`umami-runtime-${shareId}`, 3600000);
  }

  private async getShareData(): Promise<ShareData> {
    if (this.shareData) {
      return this.shareData;
    }

    if (this.sharePromise) {
      return this.sharePromise;
    }

    this.sharePromise = (async (): Promise<ShareData> => {
      const res = await fetchWithTimeout(`${this.apiBase}/share/${this.shareId}`);
      if (!res.ok) {
        this.sharePromise = null;
        throw new Error(`获取分享信息失败: ${res.status}`);
      }
      const data = await res.json();
      this.shareData = data;
      return data;
    })();

    return this.sharePromise;
  }

  async getStats(path?: string): Promise<StatsResult> {
    const cacheKey = path ? `stats-${path}` : 'stats-site';

    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { ...cached as StatsResult, _fromCache: true };
    }

    const { websiteId, token } = await this.getShareData();

    const params = new URLSearchParams({
      startAt: '0',
      endAt: Date.now().toString()
    });

    if (path) {
      params.set('path', `eq.${path}`);
    }

    const res = await fetchWithTimeout(
      `${this.apiBase}/websites/${websiteId}/stats?${params.toString()}`,
      {
        headers: {
          'x-umami-share-token': token,
          [SHARE_CONTEXT_HEADER]: SHARE_CONTEXT_VALUE
        }
      }
    );

    if (!res.ok) {
      throw new Error(`获取统计失败: ${res.status}`);
    }

    const data = await res.json();

    const result: StatsResult = {
      pageviews: data.pageviews?.value ?? data.pageviews ?? 0,
      visitors: data.visitors?.value ?? data.visitors ?? 0,
      visits: data.visits?.value ?? data.visits ?? 0
    };
    if (typeof data.bounces === 'number' || typeof data.bounces?.value === 'number') {
      result.bounces = data.bounces?.value ?? data.bounces;
    }
    if (typeof data.totaltime === 'number' || typeof data.totaltime?.value === 'number') {
      result.totaltime = data.totaltime?.value ?? data.totaltime;
    }

    this.cache.set(cacheKey, result);

    return result;
  }

  async getSiteStats(): Promise<StatsResult> {
    return this.getStats();
  }

  async getPageStats(path: string): Promise<StatsResult> {
    return this.getStats(path);
  }

  async getActiveVisitors(): Promise<number> {
    const { websiteId, token } = await this.getShareData();
    const res = await fetchWithTimeout(
      `${this.apiBase}/websites/${websiteId}/active`,
      {
        headers: {
          'x-umami-share-token': token,
          [SHARE_CONTEXT_HEADER]: SHARE_CONTEXT_VALUE
        }
      }
    );
    if (!res.ok) {
      throw new Error(`获取在线访客失败: ${res.status}`);
    }
    const data = await res.json();
    return typeof data?.visitors === 'number' ? data.visitors : 0;
  }

  clearCache(): void {
    this.cache.clear();
    this.shareData = null;
    this.sharePromise = null;
  }
}

function mountEmptyClient(): void {
  (window as typeof window & { oddmisc?: Record<string, unknown> }).oddmisc = {
    getStats: () => Promise.resolve({ pageviews: 0, visitors: 0, visits: 0 }),
    getSiteStats: () => Promise.resolve({ pageviews: 0, visitors: 0, visits: 0 }),
    getPageStats: () => Promise.resolve({ pageviews: 0, visitors: 0, visits: 0 }),
    getActiveVisitors: () => Promise.resolve(0),
    clearCache: () => {},
  };
}

export function initUmamiRuntime(config: UmamiRuntimeConfig): void {
  if (!config.shareUrl) {
    console.log('[oddmisc] shareUrl 未配置，跳过初始化');
    mountEmptyClient();
  } else {
    try {
      const client = new UmamiRuntimeClient(config);

      (window as typeof window & { oddmisc?: Record<string, unknown> }).oddmisc = {
        umami: client,
        getStats: (path?: string) => client.getStats(path),
        getSiteStats: () => client.getSiteStats(),
        getPageStats: (path: string) => client.getPageStats(path),
        getActiveVisitors: () => client.getActiveVisitors(),
        clearCache: () => client.clearCache(),
      };

      console.log('[oddmisc] Umami runtime client initialized');
    } catch (error) {
      console.warn('[oddmisc] 初始化失败:', error instanceof Error ? error.message : error);
      mountEmptyClient();
    }
  }

  window.dispatchEvent(
    new CustomEvent('oddmisc-ready', {
      detail: { client: (window as typeof window & { oddmisc?: Record<string, unknown> }).oddmisc }
    })
  );
}

export type { UmamiRuntimeConfig, StatsResult };

interface OddmiscReadyEvent extends CustomEvent {
  detail: {
    client: {
      getStats: (path?: string) => Promise<StatsResult>;
      getSiteStats: () => Promise<StatsResult>;
      getPageStats: (path: string) => Promise<StatsResult>;
      getActiveVisitors: () => Promise<number>;
      clearCache: () => void;
    };
  };
}

export type { OddmiscReadyEvent };
