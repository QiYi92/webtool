import { NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

type Point = { date: string; value: number };
type StatusColor = "success" | "warning" | "danger" | "neutral" | "yellow";

type DashboardCard = {
  id: string;
  name: string;
  ticker: string;
  value: number | null;
  unit: string;
  secondaryValue: number | null;
  dataDate: string | null;
  updateFrequency: string;
  statusText: string;
  statusColor: StatusColor;
  shortDescription: string;
  detailDescription: string;
  formula: string;
  dataRange: string;
  history: Point[];
};

type RankingItem = {
  name: string;
  value: number | null;
  changeRate: number | null;
  changeValue: number | null;
  level: number | null;
  type: string | null;
};

type BoardSection = {
  key: string;
  title: string;
  subtitle: string;
  defaultList: RankingItem[];
  topList: RankingItem[];
  bottomList: RankingItem[];
};

type Section = { key: string; title: string; cards: DashboardCard[] };
type Payload = {
  source: string;
  generatedAt: string;
  sections: Section[];
  boards: BoardSection[];
};
type CachedSnapshot = { fetchedAt: string; version?: number; payload: Payload };

type SummaryResponse = {
  success: boolean;
  data?: {
    broadMarketIndex?: number;
    diffYesterday?: number;
    diffYesterdayRatio?: number;
    historyMarketIndexList?: Array<[number, number]>;
    todayStatistics?: {
      addNum?: string | number;
      addValuation?: number;
      tradeNum?: string | number;
      turnover?: number;
      addNumRatio?: number;
      addAmountRatio?: number;
      tradeVolumeRatio?: number;
      tradeAmountRatio?: number;
    };
    yesterdayStatistics?: {
      addNum?: string | number;
      addValuation?: number;
      tradeNum?: string | number;
      turnover?: number;
    };
    surviveNum?: string | number;
    holdersNum?: string | number;
    transPerformanceTrend?: {
      history?: Array<[number, number]>;
    };
  };
};

type BlockSummaryResponse = {
  success: boolean;
  data?: Record<
    string,
    {
      defaultList?: BlockItem[];
      topList?: BlockItem[];
      bottomList?: BlockItem[];
    }
  >;
};

type BlockItem = {
  type?: string;
  name?: string;
  level?: number;
  index?: number;
  riseFallRate?: number;
  riseFallDiff?: number;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const API_BASE = "https://api.steamdt.com";
const CACHE_FILE = path.join(process.cwd(), ".cache", "invest-weather", "cs2.json");
const REFRESH_INTERVAL_MINUTES = 2;
const REFRESH_INTERVAL_MS = REFRESH_INTERVAL_MINUTES * 60 * 1000;
const CACHE_VERSION = 1;
const FETCH_TIMEOUT_MS = 5000;
const CURL_TIMEOUT_SECONDS = 8;
const REQUEST_HEADERS = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
};
const execFileAsync = promisify(execFile);
let refreshPromise: Promise<void> | null = null;

function jsonNoStore(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init?.headers ?? {})
    }
  });
}

async function curlJson<T>(url: string): Promise<T> {
  const { stdout } = await execFileAsync("curl", [
    "--silent",
    "--show-error",
    "--location",
    "--compressed",
    "--connect-timeout",
    String(CURL_TIMEOUT_SECONDS),
    "--max-time",
    String(CURL_TIMEOUT_SECONDS),
    "--header",
    `Accept: ${REQUEST_HEADERS.Accept}`,
    "--header",
    `User-Agent: ${REQUEST_HEADERS["User-Agent"]}`,
    url
  ]);
  return JSON.parse(stdout) as T;
}

async function fetchJson<T>(pathname: string): Promise<T> {
  const url = `${API_BASE}${pathname}`;
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: REQUEST_HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${pathname}: ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    console.warn(`[invest-weather:cs2] fetch fallback to curl for ${pathname}`, error);
    return curlJson<T>(url);
  }
}

function toNumber(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pointsFromPairs(
  pairs: Array<[number | string, number | string]> | undefined,
  mode: "date" | "datetime"
) {
  return (pairs ?? [])
    .map((pair) => {
      const [rawDate, rawValue] = pair;
      const value = toNumber(rawValue);
      const timestamp = typeof rawDate === "string" ? Number(rawDate) : rawDate;
      if (value === null || !Number.isFinite(timestamp)) return null;
      const date = new Date(timestamp * 1000);
      if (Number.isNaN(date.getTime())) return null;
      return {
        date:
          mode === "datetime"
            ? date.toISOString()
            : date.toISOString().slice(0, 10),
        value
      } satisfies Point;
    })
    .filter((point): point is Point => point !== null);
}

function latest(points: Point[]) {
  return points.length ? points[points.length - 1] : null;
}

function prev(points: Point[]) {
  return points.length > 1 ? points[points.length - 2] : null;
}

function getStatusForCard(id: string, value: number | null, secondaryValue: number | null) {
  if (value === null) return { text: "数据缺失", color: "neutral" as StatusColor };

  switch (id) {
    case "broad_market_index":
      if ((secondaryValue ?? 0) > 0) return { text: "市场走强", color: "success" as StatusColor };
      if ((secondaryValue ?? 0) < 0) return { text: "市场走弱", color: "warning" as StatusColor };
      return { text: "市场横盘", color: "neutral" as StatusColor };
    case "trade_turnover":
    case "trade_volume":
      if ((secondaryValue ?? 0) >= 5) return { text: "成交放量", color: "success" as StatusColor };
      if ((secondaryValue ?? 0) <= -5) return { text: "成交回落", color: "warning" as StatusColor };
      return { text: "成交平稳", color: "neutral" as StatusColor };
    case "add_valuation":
    case "add_volume":
      if ((secondaryValue ?? 0) >= 10) return { text: "新增活跃", color: "danger" as StatusColor };
      if ((secondaryValue ?? 0) <= -10) return { text: "新增回落", color: "warning" as StatusColor };
      return { text: "新增平稳", color: "neutral" as StatusColor };
    case "survive_num":
      return { text: "库存扩张中", color: "neutral" as StatusColor };
    case "holders_num":
      return { text: "持有人规模", color: "neutral" as StatusColor };
    default:
      return { text: "数据更新中", color: "neutral" as StatusColor };
  }
}

function buildCard(input: {
  id: string;
  name: string;
  ticker: string;
  value: number | null;
  unit: string;
  secondaryValue: number | null;
  dataDate: string | null;
  updateFrequency: string;
  shortDescription: string;
  detailDescription: string;
  formula: string;
  dataRange: string;
  history?: Point[];
}) {
  const status = getStatusForCard(input.id, input.value, input.secondaryValue);
  return {
    ...input,
    statusText: status.text,
    statusColor: status.color,
    history: input.history ?? []
  } satisfies DashboardCard;
}

function normalizeBoardItem(item: BlockItem): RankingItem {
  return {
    name: item.name ?? "--",
    value: toNumber(item.index),
    changeRate: toNumber(item.riseFallRate),
    changeValue: toNumber(item.riseFallDiff),
    level: typeof item.level === "number" ? item.level : null,
    type: item.type ?? null
  };
}

function boardTitle(key: string) {
  const titleMap: Record<string, { title: string; subtitle: string }> = {
    hot: { title: "热门板块", subtitle: "首页关注度最高的一组指数" },
    itemTypeLevel1: { title: "一级板块", subtitle: "大类品类维度涨跌" },
    itemTypeLevel2: { title: "二级板块", subtitle: "细分类别维度涨跌" },
    itemTypeLevel3: { title: "三级板块", subtitle: "具体系列维度涨跌" }
  };
  return titleMap[key] ?? { title: key, subtitle: "板块涨跌排行" };
}

async function readCache() {
  try {
    return JSON.parse(await readFile(CACHE_FILE, "utf8")) as CachedSnapshot;
  } catch {
    return null;
  }
}

async function writeCache(data: CachedSnapshot) {
  await mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(data), "utf8");
}

function hasCompleteMetadata(payload: Payload) {
  return payload.sections.every((section) =>
    section.cards.every(
      (card) =>
        typeof card.detailDescription === "string" &&
        card.detailDescription.length > 0 &&
        typeof card.formula === "string" &&
        card.formula.length > 0 &&
        typeof card.dataRange === "string" &&
        card.dataRange.length > 0
    )
  );
}

function isCacheCompatible(cached: CachedSnapshot) {
  return (cached.version ?? 1) >= CACHE_VERSION;
}

function isUsableCache(cached: CachedSnapshot | null): cached is CachedSnapshot {
  return Boolean(cached && isCacheCompatible(cached) && hasCompleteMetadata(cached.payload));
}

function isCacheFresh(cached: CachedSnapshot, now = new Date()) {
  const fetchedAt = new Date(cached.fetchedAt);
  if (Number.isNaN(fetchedAt.getTime())) return false;
  return now.getTime() - fetchedAt.getTime() < REFRESH_INTERVAL_MS;
}

function getNextRefreshAt(fetchedAt: string) {
  const parsed = new Date(fetchedAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getTime() + REFRESH_INTERVAL_MS).toISOString();
}

function cacheResponse(
  cached: CachedSnapshot,
  options?: { stale?: boolean; refreshed?: boolean; refreshing?: boolean }
) {
  return jsonNoStore({
    ...cached.payload,
    lastUpdatedAt: cached.fetchedAt,
    cache: {
      hit: !options?.refreshed,
      stale: options?.stale ?? false,
      refreshed: options?.refreshed ?? false,
      refreshing: options?.refreshing ?? false,
      fetchedAt: cached.fetchedAt,
      nextRefreshAt: getNextRefreshAt(cached.fetchedAt),
      refreshIntervalMinutes: REFRESH_INTERVAL_MINUTES
    }
  });
}

async function buildPayload(): Promise<Payload> {
  const [summaryResponse, blockResponse] = await Promise.all([
    fetchJson<SummaryResponse>("/index/statistics/v1/summary"),
    fetchJson<BlockSummaryResponse>("/index/item-block/v1/summary")
  ]);

  if (!summaryResponse.success || !summaryResponse.data) {
    throw new Error("SteamDT summary API returned invalid payload");
  }

  if (!blockResponse.success || !blockResponse.data) {
    throw new Error("SteamDT block summary API returned invalid payload");
  }

  const summary = summaryResponse.data;
  const history = pointsFromPairs(summary.historyMarketIndexList, "datetime");
  const lastPoint = latest(history);
  const prevPoint = prev(history);
  const overviewCards: DashboardCard[] = [
    buildCard({
      id: "broad_market_index",
      name: "大盘指数",
      ticker: "SteamDT Index",
      value: toNumber(summary.broadMarketIndex),
      unit: "点",
      secondaryValue: toNumber(summary.diffYesterdayRatio),
      dataDate: lastPoint?.date ?? null,
      updateFrequency: "分钟级",
      shortDescription: "CS2 饰品市场整体强弱的首页指数。",
      detailDescription: "首页大盘指数由 SteamDT 维护，用于反映饰品市场整体价格与流动性状态。",
      formula: "直接读取 SteamDT 首页 summary.broadMarketIndex",
      dataRange: "当日分钟级历史",
      history
    }),
    buildCard({
      id: "trade_turnover",
      name: "饰品成交额",
      ticker: "SteamDT Turnover",
      value: toNumber(summary.todayStatistics?.turnover),
      unit: "元",
      secondaryValue: toNumber(summary.todayStatistics?.tradeAmountRatio),
      dataDate: lastPoint?.date ?? null,
      updateFrequency: "分钟级",
      shortDescription: "今日成交金额总览，反映资金活跃度。",
      detailDescription: "首页成交额来自 SteamDT summary.todayStatistics.turnover，与昨日同口径数据做环比比较。",
      formula: "todayStatistics.turnover",
      dataRange: "首页即时快照"
    }),
    buildCard({
      id: "trade_volume",
      name: "饰品成交量",
      ticker: "SteamDT Volume",
      value: toNumber(summary.todayStatistics?.tradeNum),
      unit: "件",
      secondaryValue: toNumber(summary.todayStatistics?.tradeVolumeRatio),
      dataDate: lastPoint?.date ?? null,
      updateFrequency: "分钟级",
      shortDescription: "今日成交件数总览，反映市场换手热度。",
      detailDescription: "首页成交量来自 SteamDT summary.todayStatistics.tradeNum，与昨日同口径数据做环比比较。",
      formula: "todayStatistics.tradeNum",
      dataRange: "首页即时快照"
    }),
    buildCard({
      id: "add_valuation",
      name: "饰品新增额",
      ticker: "SteamDT Add Valuation",
      value: toNumber(summary.todayStatistics?.addValuation),
      unit: "元",
      secondaryValue: toNumber(summary.todayStatistics?.addAmountRatio),
      dataDate: lastPoint?.date ?? null,
      updateFrequency: "分钟级",
      shortDescription: "今日新增饰品对应估值，体现新供给规模。",
      detailDescription: "首页新增额来自 SteamDT summary.todayStatistics.addValuation，与昨日同口径数据做环比比较。",
      formula: "todayStatistics.addValuation",
      dataRange: "首页即时快照"
    }),
    buildCard({
      id: "add_volume",
      name: "饰品新增量",
      ticker: "SteamDT Add Volume",
      value: toNumber(summary.todayStatistics?.addNum),
      unit: "件",
      secondaryValue: toNumber(summary.todayStatistics?.addNumRatio),
      dataDate: lastPoint?.date ?? null,
      updateFrequency: "分钟级",
      shortDescription: "今日新增饰品件数，体现供给端活跃程度。",
      detailDescription: "首页新增量来自 SteamDT summary.todayStatistics.addNum，与昨日同口径数据做环比比较。",
      formula: "todayStatistics.addNum",
      dataRange: "首页即时快照"
    }),
    buildCard({
      id: "survive_num",
      name: "饰品存世量",
      ticker: "SteamDT Survive Num",
      value: toNumber(summary.surviveNum),
      unit: "件",
      secondaryValue: null,
      dataDate: lastPoint?.date ?? null,
      updateFrequency: "分钟级",
      shortDescription: "被纳入统计口径的在世饰品总数。",
      detailDescription: "首页存世量来自 SteamDT summary.surviveNum，反映平台统计口径下的全市场库存规模。",
      formula: "surviveNum",
      dataRange: "首页即时快照"
    }),
    buildCard({
      id: "holders_num",
      name: "持有人数",
      ticker: "SteamDT Holders",
      value: toNumber(summary.holdersNum),
      unit: "人",
      secondaryValue: null,
      dataDate: lastPoint?.date ?? null,
      updateFrequency: "分钟级",
      shortDescription: "当前持有饰品的用户人数。",
      detailDescription: "首页持有人数来自 SteamDT summary.holdersNum，用于观察市场参与广度。",
      formula: "holdersNum",
      dataRange: "首页即时快照"
    })
  ];

  const boards: BoardSection[] = Object.entries(blockResponse.data)
    .map(([key, value]) => {
      const meta = boardTitle(key);
      return {
        key,
        title: meta.title,
        subtitle: meta.subtitle,
        defaultList: (value.defaultList ?? []).map(normalizeBoardItem),
        topList: (value.topList ?? []).map(normalizeBoardItem),
        bottomList: (value.bottomList ?? []).map(normalizeBoardItem)
      } satisfies BoardSection;
    })
    .filter((section) => section.defaultList.length > 0 || section.topList.length > 0 || section.bottomList.length > 0);

  return {
    source: API_BASE,
    generatedAt: new Date().toISOString(),
    sections: [
      {
        key: "market",
        title: "市场总览",
        cards: overviewCards
      }
    ],
    boards
  };
}

async function triggerRefresh() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const payload = await buildPayload();
      const fetchedAt = new Date().toISOString();
      await writeCache({ fetchedAt, version: CACHE_VERSION, payload });
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function GET() {
  const cached = await readCache();
  if (isUsableCache(cached) && isCacheFresh(cached)) {
    return cacheResponse(cached);
  }

  if (isUsableCache(cached)) {
    void triggerRefresh().catch((error) => {
      console.error("[invest-weather:cs2] background refresh failed", error);
    });
    return cacheResponse(cached, { stale: true, refreshing: true });
  }

  try {
    await triggerRefresh();
    const refreshed = await readCache();
    if (isUsableCache(refreshed)) {
      return cacheResponse(refreshed, { refreshed: true });
    }
    return jsonNoStore({ error: "Failed to fetch SteamDT data for cs2 station" }, { status: 500 });
  } catch (error) {
    console.error("[invest-weather:cs2] refresh failed without cache", error);
    return jsonNoStore({ error: "Failed to fetch SteamDT data for cs2 station" }, { status: 500 });
  }
}
