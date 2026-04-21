interface UmamiConfig {
  /** 如: https://umami.example.com/share/abc123 */
  shareUrl: string;
}

interface StatsQueryParams {
  path?: string;
  url?: string;
  /** 起始时间（毫秒时间戳）。默认 0（即自网站建站起） */
  startAt?: number;
  /** 结束时间（毫秒时间戳）。默认当前时间 */
  endAt?: number;
}

interface StatsComparison {
  pageviews?: number;
  visitors?: number;
  visits?: number;
  bounces?: number;
  totaltime?: number;
}

interface StatsResult {
  pageviews: number;
  visitors: number;
  visits: number;
  /** 跳出数（Umami v2+ 返回） */
  bounces?: number;
  /** 总访问时长，单位秒（Umami v2+ 返回） */
  totaltime?: number;
  /** 与上一周期的对比数据（Umami v2+ 返回） */
  comparison?: StatsComparison;
  /** 是否命中本地缓存 */
  _fromCache?: boolean;
}

interface ShareData {
  websiteId: string;
  token: string;
}

/** Umami v2 支持的聚合维度；`url` / `host` 在 cloud 上会返回 400 */
type MetricType =
  | 'path'
  | 'referrer'
  | 'browser'
  | 'os'
  | 'device'
  | 'country'
  | 'region'
  | 'city'
  | 'event'
  | 'title'
  | 'language'
  | 'screen'
  | 'tag';

interface MetricEntry {
  x: string;
  y: number;
}

interface PageviewPoint {
  x: string;
  y: number;
}

interface PageviewsSeries {
  pageviews: PageviewPoint[];
  sessions: PageviewPoint[];
}

interface WebsiteInfo {
  id: string;
  name: string;
  domain: string;
  shareId: string | null;
  createdAt: string;
  updatedAt: string;
  resetAt: string | null;
}

interface DateRange {
  startDate: string;
  endDate: string;
}

export type {
  UmamiConfig,
  StatsQueryParams,
  StatsResult,
  StatsComparison,
  ShareData,
  MetricType,
  MetricEntry,
  PageviewPoint,
  PageviewsSeries,
  WebsiteInfo,
  DateRange
};
