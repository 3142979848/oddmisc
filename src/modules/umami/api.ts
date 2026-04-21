import type { ShareData, StatsQueryParams, PageviewsSeries, MetricEntry, MetricType, WebsiteInfo, DateRange } from './types';
import { CacheManager } from '../../utils/umami/cache';
import { fetchWithTimeout } from '../../utils/fetch';
import { UmamiNetworkError, UmamiAuthError } from '../../errors';

/**
 * cloud.umami.is 以及新版自托管 Umami 对 share token 请求要求此头部，
 * 缺失时所有 `/websites/*` 请求都会返回 401 Unauthorized。
 */
const SHARE_CONTEXT_HEADER = 'x-umami-share-context';
const SHARE_CONTEXT_VALUE = '1';

interface StatsAPIParams extends Partial<StatsQueryParams> {
  path?: string;
  url?: string;
}

export interface StatsAPIResponse {
  pageviews?: number | { value: number };
  visitors?: number | { value: number };
  visits?: number | { value: number };
  bounces?: number | { value: number };
  totaltime?: number | { value: number };
  comparison?: {
    pageviews?: number;
    visitors?: number;
    visits?: number;
    bounces?: number;
    totaltime?: number;
  };
  _fromCache?: boolean;
  [key: string]: unknown;
}

export interface TimeRange {
  startAt?: number;
  endAt?: number;
}

export interface PageviewsParams extends TimeRange {
  unit?: 'year' | 'month' | 'day' | 'hour' | 'minute';
  timezone?: string;
}

export interface MetricsParams extends TimeRange {
  limit?: number;
}

export class UmamiAPI {
  private cacheManager: CacheManager;
  private sharePromise: Promise<ShareData> | null = null;

  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;
  }

  async getShareData(baseUrl: string, shareId: string): Promise<ShareData> {
    if (!this.sharePromise) {
      this.sharePromise = this.fetchShareData(baseUrl, shareId).catch((err) => {
        this.sharePromise = null;
        throw err;
      });
    }
    return this.sharePromise;
  }

  private async fetchShareData(baseUrl: string, shareId: string): Promise<ShareData> {
    const res = await fetchWithTimeout(`${baseUrl}/share/${shareId}`);
    if (!res.ok) {
      throw new UmamiNetworkError(`获取分享信息失败: ${res.status}`, res.status);
    }
    return res.json();
  }

  private async authedGet<T>(baseUrl: string, shareId: string, path: string, cacheKey: string | null): Promise<T & { _fromCache?: boolean }> {
    if (cacheKey) {
      const cached = this.cacheManager.get(cacheKey) as T | null;
      if (cached) {
        return { ...(cached as object), _fromCache: true } as T & { _fromCache?: boolean };
      }
    }

    const { token } = await this.getShareData(baseUrl, shareId);
    const res = await fetchWithTimeout(`${baseUrl}${path}`, {
      headers: {
        'x-umami-share-token': token,
        [SHARE_CONTEXT_HEADER]: SHARE_CONTEXT_VALUE
      }
    });

    if (!res.ok) {
      if (res.status === 401) {
        this.cacheManager.clear();
        this.sharePromise = null;
        throw new UmamiAuthError('认证失败，请检查 shareId', res.status);
      }
      throw new UmamiNetworkError(`请求 ${path} 失败: ${res.status}`, res.status);
    }

    const data = (await res.json()) as T;
    if (cacheKey) {
      this.cacheManager.set(cacheKey, data as unknown);
    }
    return data as T & { _fromCache?: boolean };
  }

  private buildRangeQuery(range: TimeRange = {}): URLSearchParams {
    const qp = new URLSearchParams({
      startAt: (range.startAt ?? 0).toString(),
      endAt: (range.endAt ?? Date.now()).toString()
    });
    return qp;
  }

  async getStats(baseUrl: string, shareId: string, params: StatsAPIParams): Promise<StatsAPIResponse> {
    const cacheKey = `${baseUrl}|${shareId}|stats|${JSON.stringify(params)}`;
    const { websiteId } = await this.getShareData(baseUrl, shareId);

    const queryParams = this.buildRangeQuery(params);
    if (params.path) queryParams.set('path', params.path);
    if (params.url) queryParams.set('url', params.url);

    return this.authedGet<StatsAPIResponse>(
      baseUrl,
      shareId,
      `/websites/${websiteId}/stats?${queryParams.toString()}`,
      cacheKey
    );
  }

  async getActiveVisitors(baseUrl: string, shareId: string): Promise<{ visitors: number; _fromCache?: boolean }> {
    const { websiteId } = await this.getShareData(baseUrl, shareId);
    // 活跃访客是实时数据，不缓存
    return this.authedGet<{ visitors: number }>(
      baseUrl,
      shareId,
      `/websites/${websiteId}/active`,
      null
    );
  }

  async getWebsite(baseUrl: string, shareId: string): Promise<WebsiteInfo & { _fromCache?: boolean }> {
    const { websiteId } = await this.getShareData(baseUrl, shareId);
    return this.authedGet<WebsiteInfo>(
      baseUrl,
      shareId,
      `/websites/${websiteId}`,
      `${baseUrl}|${shareId}|website`
    );
  }

  async getDateRange(baseUrl: string, shareId: string): Promise<DateRange & { _fromCache?: boolean }> {
    const { websiteId } = await this.getShareData(baseUrl, shareId);
    return this.authedGet<DateRange>(
      baseUrl,
      shareId,
      `/websites/${websiteId}/daterange`,
      `${baseUrl}|${shareId}|daterange`
    );
  }

  async getPageviews(baseUrl: string, shareId: string, params: PageviewsParams = {}): Promise<PageviewsSeries & { _fromCache?: boolean }> {
    const { websiteId } = await this.getShareData(baseUrl, shareId);
    const qp = this.buildRangeQuery(params);
    qp.set('unit', params.unit ?? 'day');
    qp.set('timezone', params.timezone ?? 'UTC');
    const cacheKey = `${baseUrl}|${shareId}|pageviews|${qp.toString()}`;
    return this.authedGet<PageviewsSeries>(
      baseUrl,
      shareId,
      `/websites/${websiteId}/pageviews?${qp.toString()}`,
      cacheKey
    );
  }

  async getMetrics(baseUrl: string, shareId: string, type: MetricType, params: MetricsParams = {}): Promise<MetricEntry[]> {
    const { websiteId } = await this.getShareData(baseUrl, shareId);
    const qp = this.buildRangeQuery(params);
    qp.set('type', type);
    if (typeof params.limit === 'number') qp.set('limit', params.limit.toString());
    const cacheKey = `${baseUrl}|${shareId}|metrics|${qp.toString()}`;

    // 缓存层只存 JSON 对象，数组需要包一层
    const cached = this.cacheManager.get(cacheKey) as { data: MetricEntry[] } | null;
    if (cached) return cached.data;

    const { token } = await this.getShareData(baseUrl, shareId);
    const res = await fetchWithTimeout(`${baseUrl}/websites/${websiteId}/metrics?${qp.toString()}`, {
      headers: {
        'x-umami-share-token': token,
        [SHARE_CONTEXT_HEADER]: SHARE_CONTEXT_VALUE
      }
    });
    if (!res.ok) {
      if (res.status === 401) {
        this.cacheManager.clear();
        this.sharePromise = null;
        throw new UmamiAuthError('认证失败，请检查 shareId', res.status);
      }
      throw new UmamiNetworkError(`获取 metrics(${type}) 失败: ${res.status}`, res.status);
    }
    const data = (await res.json()) as MetricEntry[];
    this.cacheManager.set(cacheKey, { data });
    return data;
  }

  clearShareCache(): void {
    this.sharePromise = null;
  }
}
