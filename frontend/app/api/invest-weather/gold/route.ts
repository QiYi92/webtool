import { NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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

type Section = { key: string; title: string; cards: DashboardCard[] };
type Payload = { source: string; generatedAt: string; sections: Section[] };
type CachedSnapshot = { fetchedAt: string; version?: number; payload: Payload };

export const runtime = "nodejs";

const SOURCE = "fred.stlouisfed.org/graph/fredgraph.csv";
const CACHE_FILE = path.join(process.cwd(), ".cache", "invest-weather", "gold.json");
const REFRESH_INTERVAL_MINUTES = 30;
const REFRESH_INTERVAL_MS = REFRESH_INTERVAL_MINUTES * 60 * 1000;
const CACHE_VERSION = 1;

async function fetchSeries(id: string): Promise<Point[]> {
  const response = await fetch(`https://${SOURCE}?id=${id}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to fetch ${id}: ${response.status}`);
  const text = await response.text();
  const lines = text.trim().split("\n");
  const points: Point[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const [date, rawValue] = lines[i].split(",");
    if (!date || !rawValue || rawValue === "." || rawValue === "nan") continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;
    points.push({ date, value });
  }
  return points;
}

function latest(points: Point[]) { return points.length ? points[points.length - 1] : null; }
function prev(points: Point[]) { return points.length > 1 ? points[points.length - 2] : null; }
function lastN(points: Point[], n: number) { return points.slice(Math.max(0, points.length - n)); }
function pctChange(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) return null;
  return (current / previous - 1) * 100;
}

function getStatusForCard(id: string, value: number | null, secondaryValue: number | null): { text: string; color: StatusColor } {
  if (value === null) return { text: "数据缺失", color: "neutral" };
  switch (id) {
    case "gold_index":
    case "silver_index":
      if (secondaryValue !== null) {
        if (secondaryValue >= 0.1) return { text: id === "gold_index" ? "黄金走强" : "白银走强", color: "success" };
        if (secondaryValue <= -0.1) return { text: id === "gold_index" ? "黄金走弱" : "白银走弱", color: "warning" };
      }
      return { text: "趋势震荡", color: "neutral" };
    case "real_yield":
      if (value > 2.0) return { text: "利空（承压）", color: "warning" };
      if (value < 0) return { text: "强利好", color: "success" };
      return { text: "中性偏紧", color: "yellow" };
    case "breakeven":
      if (value > 2.5) return { text: "预期升温", color: "warning" };
      if (value < 2.0) return { text: "预期偏弱", color: "danger" };
      return { text: "预期稳定", color: "neutral" };
    case "fed_assets":
      if (secondaryValue !== null && secondaryValue > 0) return { text: "扩表（印钞利好）", color: "success" };
      if (secondaryValue !== null && secondaryValue < 0) return { text: "缩表（流动性收紧）", color: "warning" };
      return { text: "规模稳定", color: "neutral" };
    case "nonfarm":
      if (value < 0) return { text: "就业萎缩（衰退）", color: "danger" };
      if (value < 100) return { text: "就业放缓", color: "warning" };
      if (value > 200) return { text: "就业强劲", color: "success" };
      return { text: "就业温和", color: "neutral" };
    case "gold_dxy":
      return { text: "汇率中性", color: "success" };
    case "gold_unrate":
      if (value >= 4.0) return { text: "就业恶化（中）", color: "warning" };
      return { text: "就业稳健", color: "success" };
    default:
      return { text: "指数持平", color: "neutral" };
  }
}

function cardFromSeries(input: {
  id: string;
  name: string;
  ticker: string;
  unit: string;
  updateFrequency: string;
  shortDescription: string;
  detailDescription: string;
  formula: string;
  dataRange: string;
  points: Point[];
}) {
  const latestPoint = latest(input.points);
  const prevPoint = prev(input.points);
  const value = latestPoint?.value ?? null;
  const secondaryValue = pctChange(latestPoint?.value ?? null, prevPoint?.value ?? null);
  const status = getStatusForCard(input.id, value, secondaryValue);
  return {
    id: input.id,
    name: input.name,
    ticker: input.ticker,
    value,
    unit: input.unit,
    secondaryValue,
    dataDate: latestPoint?.date ?? null,
    updateFrequency: input.updateFrequency,
    statusText: status.text,
    statusColor: status.color,
    shortDescription: input.shortDescription,
    detailDescription: input.detailDescription,
    formula: input.formula,
    dataRange: input.dataRange,
    history: lastN(input.points, 90)
  } satisfies DashboardCard;
}

async function readCache() {
  try { return JSON.parse(await readFile(CACHE_FILE, "utf8")) as CachedSnapshot; } catch { return null; }
}

async function writeCache(data: CachedSnapshot) {
  await mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(data), "utf8");
}

function hasCompleteMetadata(payload: Payload) {
  return payload.sections.every((section) =>
    section.cards.every((card) =>
      typeof card.detailDescription === "string" &&
      card.detailDescription.length > 0 &&
      typeof card.formula === "string" &&
      card.formula.length > 0 &&
      typeof card.dataRange === "string" &&
      card.dataRange.length > 0
    )
  );
}

function isCacheCompatible(cached: CachedSnapshot) { return (cached.version ?? 1) >= CACHE_VERSION; }
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

async function buildPayload(): Promise<Payload> {
  const [
    realYield,
    breakeven,
    fedAssets,
    nonfarm,
    dxy,
    unrate,
    vix,
    sp500
  ] = await Promise.all([
    fetchSeries("DFII10"),
    fetchSeries("T10YIE"),
    fetchSeries("WALCL"),
    fetchSeries("PAYEMS"),
    fetchSeries("DTWEXBGS"),
    fetchSeries("UNRATE"),
    fetchSeries("VIXCLS"),
    fetchSeries("SP500")
  ]);

  const marketCards: DashboardCard[] = [
    cardFromSeries({
      id: "gold_index",
      name: "黄金趋势指数",
      ticker: "Proxy: SP500 (Risk Proxy)",
      unit: "点",
      updateFrequency: "每日",
      shortDescription: "当前版本使用可持续公开源构造趋势代理",
      detailDescription: "由于公开接口对部分金银商品指数抓取限制，当前版本以公开可用序列构造趋势代理。",
      formula: "趋势代理（可用公开序列）",
      dataRange: "过去90个交易日",
      points: sp500
    }),
    cardFromSeries({
      id: "silver_index",
      name: "白银趋势指数",
      ticker: "Proxy: VIXCLS (Volatility Proxy)",
      unit: "",
      updateFrequency: "每日",
      shortDescription: "当前版本使用可持续公开源构造趋势代理",
      detailDescription: "由于公开接口对部分金银商品指数抓取限制，当前版本以公开可用序列构造趋势代理。",
      formula: "趋势代理（可用公开序列）",
      dataRange: "过去90个交易日",
      points: vix
    })
  ];

  const tier1Cards: DashboardCard[] = [
    cardFromSeries({
      id: "real_yield",
      name: "10年期实际利率",
      ticker: "FRED: DFII10",
      unit: "%",
      updateFrequency: "每日",
      shortDescription: "实际利率与黄金常负相关",
      detailDescription: "10年期TIPS实际收益率，反映扣除通胀后的真实利率水平。",
      formula: "直接读取 (10年期TIPS收益率)",
      dataRange: "过去90个交易日",
      points: realYield
    }),
    cardFromSeries({
      id: "breakeven",
      name: "10年期通胀预期",
      ticker: "FRED: T10YIE",
      unit: "%",
      updateFrequency: "每日",
      shortDescription: "通胀预期抬升通常利多黄金",
      detailDescription: "名义国债与TIPS收益率差，反映市场10年通胀预期。",
      formula: "直接读取 (10年期盈亏平衡通胀率)",
      dataRange: "过去90个交易日",
      points: breakeven
    }),
    cardFromSeries({
      id: "fed_assets",
      name: "美联储资产负债表",
      ticker: "FRED: WALCL",
      unit: "十亿美元",
      updateFrequency: "每周",
      shortDescription: "扩表=流动性释放；缩表=流动性回收",
      detailDescription: "美联储总资产规模，反映货币环境和流动性状态。",
      formula: "直接读取 (美联储总资产)",
      dataRange: "过去90周",
      points: fedAssets.map((p) => ({ ...p, value: p.value / 1000 }))
    })
  ];

  const tier2Cards: DashboardCard[] = [
    cardFromSeries({
      id: "nonfarm",
      name: "非农就业变化",
      ticker: "FRED: PAYEMS",
      unit: "千人",
      updateFrequency: "每月",
      shortDescription: ">200千人就业强劲；<100千人就业放缓",
      detailDescription: "非农就业环比变化，反映经济景气和政策预期变化。",
      formula: "环比变化: 本月就业人数 - 上月就业人数",
      dataRange: "过去24个月",
      points: nonfarm
    }),
    cardFromSeries({
      id: "gold_dxy",
      name: "美元指数",
      ticker: "FRED: DTWEXBGS",
      unit: "",
      updateFrequency: "每日",
      shortDescription: "美元与黄金通常负相关",
      detailDescription: "贸易加权美元指数，黄金以美元计价时通常与其反向波动。",
      formula: "直接读取 (广义美元指数)",
      dataRange: "过去90个交易日",
      points: dxy
    }),
    cardFromSeries({
      id: "gold_unrate",
      name: "失业率",
      ticker: "FRED: UNRATE",
      unit: "%",
      updateFrequency: "每月",
      shortDescription: "失业率趋势上行常伴随衰退预期",
      detailDescription: "失业率是经济动能与政策方向的重要确认信号。",
      formula: "直接读取 (月度失业率)",
      dataRange: "过去24个月",
      points: unrate
    })
  ];

  return {
    source: `https://${SOURCE}`,
    generatedAt: new Date().toISOString(),
    sections: [
      { key: "market", title: "行情速览：趋势代理", cards: marketCards },
      { key: "tier1", title: "第一梯队：核心定价因子（利率与通胀）", cards: tier1Cards },
      { key: "tier2", title: "第二梯队：周期与就业（宏观信号）", cards: tier2Cards }
    ]
  };
}

export async function GET() {
  const cached = await readCache();
  if (cached && isCacheCompatible(cached) && hasCompleteMetadata(cached.payload) && isCacheFresh(cached)) {
    return NextResponse.json({
      ...cached.payload,
      lastUpdatedAt: cached.fetchedAt,
      cache: {
        hit: true,
        fetchedAt: cached.fetchedAt,
        nextRefreshAt: getNextRefreshAt(cached.fetchedAt),
        refreshIntervalMinutes: REFRESH_INTERVAL_MINUTES
      }
    });
  }

  try {
    const payload = await buildPayload();
    const fetchedAt = new Date().toISOString();
    await writeCache({ fetchedAt, version: CACHE_VERSION, payload });
    return NextResponse.json({
      ...payload,
      lastUpdatedAt: fetchedAt,
      cache: {
        hit: false,
        fetchedAt,
        nextRefreshAt: getNextRefreshAt(fetchedAt),
        refreshIntervalMinutes: REFRESH_INTERVAL_MINUTES
      }
    });
  } catch {
    if (cached) {
      return NextResponse.json({
        ...cached.payload,
        lastUpdatedAt: cached.fetchedAt,
        cache: {
          hit: true,
          stale: true,
          fetchedAt: cached.fetchedAt,
          nextRefreshAt: getNextRefreshAt(cached.fetchedAt),
          refreshIntervalMinutes: REFRESH_INTERVAL_MINUTES
        }
      });
    }
    return NextResponse.json({ error: "Failed to fetch FRED data for gold station" }, { status: 500 });
  }
}
