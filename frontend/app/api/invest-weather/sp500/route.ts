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
const FRED_API_SOURCE = "api.stlouisfed.org/fred/series/observations";
const FRED_API_KEY = process.env.FRED_API_KEY?.trim();
const CACHE_FILE = path.join(process.cwd(), ".cache", "invest-weather", "sp500.json");
const REFRESH_INTERVAL_MINUTES = 30;
const REFRESH_INTERVAL_MS = REFRESH_INTERVAL_MINUTES * 60 * 1000;
const CACHE_VERSION = 1;

async function fetchSeries(id: string): Promise<Point[]> {
  if (FRED_API_KEY) {
    const params = new URLSearchParams({
      series_id: id,
      api_key: FRED_API_KEY,
      file_type: "json",
      sort_order: "asc"
    });
    const apiUrl = `https://${FRED_API_SOURCE}?${params.toString()}`;
    const apiResponse = await fetch(apiUrl, { cache: "no-store" });
    if (!apiResponse.ok) throw new Error(`Failed to fetch ${id} from FRED API: ${apiResponse.status}`);
    const data = (await apiResponse.json()) as {
      observations?: Array<{ date?: string; value?: string }>;
    };
    const observations = Array.isArray(data.observations) ? data.observations : [];
    const points: Point[] = [];
    for (const item of observations) {
      const date = item.date;
      const rawValue = item.value;
      if (!date || !rawValue || rawValue === "." || rawValue.toLowerCase() === "nan") continue;
      const value = Number(rawValue);
      if (!Number.isFinite(value)) continue;
      points.push({ date, value });
    }
    return points;
  }

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

function yoySeries(points: Point[]) {
  const m = new Map(points.map((p) => [p.date, p.value]));
  const out: Point[] = [];
  for (const current of points) {
    const d = new Date(`${current.date}T00:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    const prevDate = d.toISOString().slice(0, 10);
    const prevValue = m.get(prevDate);
    if (prevValue === undefined || prevValue === 0) continue;
    out.push({ date: current.date, value: (current.value / prevValue - 1) * 100 });
  }
  return out;
}

function yoySeriesByLag(points: Point[], lag: number) {
  const out: Point[] = [];
  for (let i = lag; i < points.length; i += 1) {
    const past = points[i - lag];
    if (!past || past.value === 0) continue;
    out.push({ date: points[i].date, value: (points[i].value / past.value - 1) * 100 });
  }
  return out;
}

function pickLatestAtOrBefore(points: Point[], date: string): Point | null {
  for (let i = points.length - 1; i >= 0; i -= 1) if (points[i].date <= date) return points[i];
  return null;
}

function pickFromYearsAgo(points: Point[], date: string, years: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  const target = d.toISOString().slice(0, 10);
  return points.find((p) => p.date >= target)?.date ?? points[0]?.date ?? null;
}

function buffettTrendSeries(sp500: Point[], gdp: Point[]) {
  const latestSp = latest(sp500);
  if (!latestSp) return [];
  const startDate = pickFromYearsAgo(sp500, latestSp.date, 3);
  if (!startDate) return [];
  const raw: Point[] = [];
  for (const sp of sp500) {
    if (sp.date < startDate) continue;
    const gdpPoint = pickLatestAtOrBefore(gdp, sp.date);
    if (!gdpPoint || gdpPoint.value === 0) continue;
    raw.push({ date: sp.date, value: (sp.value / gdpPoint.value) * 480 });
  }
  return lastN(raw, 90);
}

function getStatusForCard(id: string, value: number | null, secondaryValue: number | null): { text: string; color: StatusColor } {
  if (value === null) return { text: "数据缺失", color: "neutral" };
  switch (id) {
    case "sp500_index":
      if (secondaryValue !== null) {
        if (secondaryValue >= 0.1) return { text: "指数上涨", color: "success" };
        if (secondaryValue <= -0.1) return { text: "指数下跌", color: "warning" };
      }
      return { text: "指数持平", color: "neutral" };
    case "dgs10":
      if (value > 4.5) return { text: "估值承压", color: "warning" };
      if (value < 4.0) return { text: "估值回暖", color: "success" };
      return { text: "中性区间", color: "neutral" };
    case "fedfunds":
      if (value > 4.0) return { text: "利率偏高", color: "warning" };
      if (value < 2.0) return { text: "利率宽松", color: "success" };
      return { text: "利率维持", color: "neutral" };
    case "unrate":
      if (value >= 4.0) return { text: "就业恶化（中）", color: "warning" };
      return { text: "就业稳健", color: "success" };
    case "vix":
      if (value > 30) return { text: "恐慌偏高", color: "danger" };
      if (value < 12) return { text: "情绪过热", color: "success" };
      return { text: "正常波动", color: "neutral" };
    case "hyd":
      if (value > 5) return { text: "信用恶化", color: "danger" };
      if (value < 3.5) return { text: "信用良好", color: "success" };
      return { text: "信用中性", color: "neutral" };
    case "stress":
      if (value < 0) return { text: "金融环境宽松", color: "success" };
      if (value > 0) return { text: "金融环境偏紧", color: "warning" };
      return { text: "压力中性", color: "neutral" };
    case "dxy":
      return { text: "汇率中性", color: "success" };
    case "curve":
      if (value < 0) return { text: "倒挂风险", color: "danger" };
      if (value < 0.5) return { text: "曲线偏平", color: "warning" };
      return { text: "曲线正常", color: "success" };
    case "buffett":
      if (value >= 100) return { text: "估值扩张区间", color: "warning" };
      return { text: "估值收缩区间", color: "success" };
    case "margin":
      if (value > 0) return { text: "杠杆上升", color: "warning" };
      return { text: "杠杆回落", color: "success" };
    case "cpi":
      if (value > 3) return { text: "通胀偏高", color: "warning" };
      return { text: "通胀受控", color: "success" };
    case "indpro":
      if (value < 0) return { text: "经济收缩", color: "danger" };
      if (value < 1) return { text: "增长偏弱", color: "warning" };
      return { text: "经济扩张", color: "success" };
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
    sp500,
    dgs10,
    fedfunds,
    unrate,
    vix,
    hyd,
    dxy,
    stress,
    curve,
    cpiLevel,
    indproLevel,
    gdp,
    marginLevel
  ] = await Promise.all([
    fetchSeries("SP500"),
    fetchSeries("DGS10"),
    fetchSeries("FEDFUNDS"),
    fetchSeries("UNRATE"),
    fetchSeries("VIXCLS"),
    fetchSeries("BAMLH0A0HYM2"),
    fetchSeries("DTWEXBGS"),
    fetchSeries("STLFSI4"),
    fetchSeries("T10Y2Y"),
    fetchSeries("CPIAUCSL"),
    fetchSeries("INDPRO"),
    fetchSeries("GDP"),
    fetchSeries("BOGZ1FL663067003Q")
  ]);

  const cpiYoy = yoySeries(cpiLevel);
  const indproYoy = yoySeries(indproLevel);
  const marginYoy = yoySeriesByLag(marginLevel, 4);
  const buffett = buffettTrendSeries(sp500, gdp);

  const marketCards: DashboardCard[] = [
    cardFromSeries({
      id: "sp500_index",
      name: "标普500指数",
      ticker: "FRED: SP500",
      unit: "点",
      updateFrequency: "每日",
      shortDescription: "美股大盘整体趋势基准",
      detailDescription: "标普500指数实时走势，反映美股大盘整体表现。",
      formula: "直接读取 (标普500指数)",
      dataRange: "过去90个交易日",
      points: sp500
    })
  ];

  const tier1Cards: DashboardCard[] = [
    cardFromSeries({
      id: "unrate",
      name: "失业率",
      ticker: "FRED: UNRATE",
      unit: "%",
      updateFrequency: "每月",
      shortDescription: "失业率快速上升通常对应衰退风险上行",
      detailDescription: "美国劳动力市场核心指标，反映就业景气与内需韧性。",
      formula: "直接读取 (月度失业率)",
      dataRange: "过去24个月",
      points: unrate
    }),
    cardFromSeries({
      id: "vix",
      name: "标普波动率",
      ticker: "FRED: VIXCLS",
      unit: "",
      updateFrequency: "每日",
      shortDescription: "12-20常态；>30恐慌",
      detailDescription: "VIX是标普500预期波动指标，常用于识别风险偏好变化。",
      formula: "直接读取 (CBOE VIX)",
      dataRange: "过去90个交易日",
      points: vix
    }),
    cardFromSeries({
      id: "dgs10",
      name: "10年期美债收益率",
      ticker: "FRED: DGS10",
      unit: "%",
      updateFrequency: "每日",
      shortDescription: "无风险利率锚，影响估值折现",
      detailDescription: "10年期美债收益率是大类资产估值的重要折现锚。",
      formula: "直接读取",
      dataRange: "过去90个交易日",
      points: dgs10
    }),
    cardFromSeries({
      id: "fedfunds",
      name: "联邦基金利率",
      ticker: "FRED: FEDFUNDS",
      unit: "%",
      updateFrequency: "每月",
      shortDescription: "政策利率决定流动性松紧",
      detailDescription: "美联储政策利率，影响风险资产估值与信用扩张。",
      formula: "直接读取",
      dataRange: "过去90个交易日",
      points: fedfunds
    })
  ];

  const tier2Cards: DashboardCard[] = [
    cardFromSeries({
      id: "hyd",
      name: "高收益债利差",
      ticker: "FRED: BAMLH0A0HYM2",
      unit: "%",
      updateFrequency: "每日",
      shortDescription: "信用风险溢价温度计",
      detailDescription: "高收益债与国债利差反映信用风险与融资环境。",
      formula: "直接读取 (高收益债利差)",
      dataRange: "过去90个交易日",
      points: hyd
    }),
    cardFromSeries({
      id: "stress",
      name: "金融压力指数",
      ticker: "FRED: STLFSI4",
      unit: "",
      updateFrequency: "每周",
      shortDescription: "<0偏宽松，>0偏紧",
      detailDescription: "圣路易斯联储金融压力指数，监测系统性融资压力。",
      formula: "直接读取 (金融压力指数 STL)",
      dataRange: "过去90个交易日",
      points: stress
    }),
    cardFromSeries({
      id: "curve",
      name: "收益率曲线利差",
      ticker: "FRED: T10Y2Y",
      unit: "%",
      updateFrequency: "每日",
      shortDescription: "倒挂常是衰退预警",
      detailDescription: "10Y-2Y利差，反映经济周期与政策预期。",
      formula: "10年期收益率 - 2年期收益率",
      dataRange: "过去90个交易日",
      points: curve
    }),
    cardFromSeries({
      id: "dxy",
      name: "广义美元指数",
      ticker: "FRED: DTWEXBGS",
      unit: "",
      updateFrequency: "每日",
      shortDescription: "美元强弱影响跨国企业盈利换算",
      detailDescription: "贸易加权美元指数，反映美元对企业盈利与风险偏好的影响。",
      formula: "直接读取 (广义美元指数)",
      dataRange: "过去90个交易日",
      points: dxy
    })
  ];

  const tier3Cards: DashboardCard[] = [
    cardFromSeries({
      id: "buffett",
      name: "市场估值指标",
      ticker: "FRED: SP500/GDP",
      unit: "",
      updateFrequency: "每日/每季度",
      shortDescription: "趋势上行=估值扩张",
      detailDescription: "SP500/GDP趋势追踪指标，观察估值扩张或收缩。",
      formula: "SP500指数 / GDP (趋势追踪)",
      dataRange: "过去90天 (基于3年数据)",
      points: buffett
    }),
    cardFromSeries({
      id: "margin",
      name: "融资余额增速",
      ticker: "FRED: BOGZ1FL663067003Q (YoY)",
      unit: "YoY%",
      updateFrequency: "每季度",
      shortDescription: "杠杆扩张速度",
      detailDescription: "证券保证金贷款同比增速，反映市场风险偏好与杠杆周期。",
      formula: "同比增速: (本季-去年同季)/去年同季",
      dataRange: "过去20个季度",
      points: lastN(marginYoy, 20)
    }),
    cardFromSeries({
      id: "cpi",
      name: "CPI通胀率",
      ticker: "FRED: CPIAUCSL (YoY)",
      unit: "YoY%",
      updateFrequency: "每月",
      shortDescription: "通胀水平影响政策与估值",
      detailDescription: "消费者物价同比增速，是美联储政策约束的重要指标。",
      formula: "同比增速: (本月-去年同月)/去年同月",
      dataRange: "过去24个月",
      points: cpiYoy
    }),
    cardFromSeries({
      id: "indpro",
      name: "工业生产指数",
      ticker: "FRED: INDPRO (YoY)",
      unit: "YoY%",
      updateFrequency: "每月",
      shortDescription: "实体经济周期信号",
      detailDescription: "工业生产同比增速，衡量制造业与实体经济动能。",
      formula: "同比增速: (本月-去年同月)/去年同月",
      dataRange: "过去24个月",
      points: indproYoy
    })
  ];

  return {
    source: `https://${SOURCE}`,
    generatedAt: new Date().toISOString(),
    sections: [
      { key: "market", title: "行情速览：指数走势", cards: marketCards },
      { key: "tier1", title: "第一梯队：核心驱动力（就业与波动）", cards: tier1Cards },
      { key: "tier2", title: "第二梯队：市场健康度（风险结构）", cards: tier2Cards },
      { key: "tier3", title: "第三梯队：长期宏观（周期位置）", cards: tier3Cards }
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
    return NextResponse.json({ error: "Failed to fetch FRED data for sp500 station" }, { status: 500 });
  }
}
