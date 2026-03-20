import { NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Point = {
  date: string;
  value: number;
};

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

type Section = {
  key: string;
  title: string;
  cards: DashboardCard[];
};

type Payload = {
  source: string;
  generatedAt: string;
  sections: Section[];
};

type CachedSnapshot = {
  snapshotDate?: string;
  fetchedAt: string;
  version?: number;
  payload: Payload;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SOURCE = "fred.stlouisfed.org/graph/fredgraph.csv";
const FRED_API_SOURCE = "api.stlouisfed.org/fred/series/observations";
const FRED_API_KEY = process.env.FRED_API_KEY?.trim();
const CACHE_FILE = path.join(process.cwd(), ".cache", "invest-weather", "nasdaq.json");
const REFRESH_INTERVAL_MINUTES = 30;
const REFRESH_INTERVAL_MS = REFRESH_INTERVAL_MINUTES * 60 * 1000;
const CACHE_VERSION = 5;
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
    if (!apiResponse.ok) {
      throw new Error(`Failed to fetch ${id} from FRED API: ${apiResponse.status}`);
    }
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

  const csvUrl = `https://${SOURCE}?id=${id}`;
  const csvResponse = await fetch(csvUrl, { cache: "no-store" });
  if (!csvResponse.ok) {
    throw new Error(`Failed to fetch ${id}: ${csvResponse.status}`);
  }
  const text = await csvResponse.text();
  const lines = text.trim().split("\n");
  const points: Point[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    const [date, rawValue] = line.split(",");
    if (!date || !rawValue || rawValue === "." || rawValue === "nan") continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;
    points.push({ date, value });
  }
  return points;
}

function latest(points: Point[]): Point | null {
  if (points.length === 0) return null;
  return points[points.length - 1];
}

function prev(points: Point[]): Point | null {
  if (points.length < 2) return null;
  return points[points.length - 2];
}

function pctChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current / previous - 1) * 100;
}

function lastN(points: Point[], n: number) {
  return points.slice(Math.max(0, points.length - n));
}

function ratioSeries(a: Point[], b: Point[]) {
  const bMap = new Map(b.map((item) => [item.date, item.value]));
  const out: Point[] = [];
  for (const p of a) {
    const bVal = bMap.get(p.date);
    if (bVal === undefined || bVal === 0) continue;
    out.push({ date: p.date, value: p.value / bVal });
  }
  return out;
}

function yoySeries(points: Point[]) {
  const pointMap = new Map(points.map((point) => [point.date, point.value]));
  const out: Point[] = [];
  for (const current of points) {
    const d = new Date(`${current.date}T00:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() - 1);
    const prevDate = d.toISOString().slice(0, 10);
    const prevValue = pointMap.get(prevDate);
    if (prevValue === undefined || prevValue === 0) continue;
    out.push({
      date: current.date,
      value: (current.value / prevValue - 1) * 100
    });
  }
  return out;
}

function yoySeriesByLag(points: Point[], lag: number) {
  const out: Point[] = [];
  for (let i = lag; i < points.length; i += 1) {
    const current = points[i];
    const past = points[i - lag];
    if (!past || past.value === 0) continue;
    out.push({
      date: current.date,
      value: (current.value / past.value - 1) * 100
    });
  }
  return out;
}

function pickLatestAtOrBefore(points: Point[], date: string): Point | null {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    if (points[i].date <= date) return points[i];
  }
  return null;
}

function pickFromYearsAgo(points: Point[], date: string, years: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  const target = d.toISOString().slice(0, 10);
  return points.find((p) => p.date >= target)?.date ?? points[0]?.date ?? null;
}

function buffettTrendSeries(sp500: Point[], gdp: Point[]) {
  if (sp500.length === 0 || gdp.length === 0) return [];
  const latestSp = latest(sp500);
  if (!latestSp) return [];
  const startDate = pickFromYearsAgo(sp500, latestSp.date, 3);
  if (!startDate) return [];

  const raw: Point[] = [];
  for (const sp of sp500) {
    if (sp.date < startDate) continue;
    const gdpPoint = pickLatestAtOrBefore(gdp, sp.date);
    if (!gdpPoint || gdpPoint.value === 0) continue;
    raw.push({
      date: sp.date,
      value: (sp.value / gdpPoint.value) * 480
    });
  }
  return lastN(raw, 90);
}

function getStatusForCard(
  id: string,
  value: number | null,
  secondaryValue: number | null
): { text: string; color: StatusColor } {
  if (value === null) return { text: "数据缺失", color: "neutral" };
  switch (id) {
    case "nasdaq_index":
    case "nasdaq100_index":
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
    case "tech_strength":
      if (secondaryValue !== null) {
        if (secondaryValue > 0.05) return { text: "科技领涨（强）", color: "success" };
        if (secondaryValue < -0.05) return { text: "科技走弱", color: "warning" };
        return { text: "相对持平", color: "neutral" };
      }
      if (value > 3.4) return { text: "科技领涨（强）", color: "success" };
      return { text: "科技走弱", color: "warning" };
    case "vxn":
      if (value > 30) return { text: "恐慌偏高", color: "danger" };
      if (value < 15) return { text: "情绪乐观", color: "success" };
      return { text: "震荡区间", color: "neutral" };
    case "real_rate":
      if (value > 1.0) return { text: "实际利率偏高", color: "yellow" };
      if (value < 1.0) return { text: "利率压力缓和", color: "success" };
      return { text: "中性区间", color: "neutral" };
    case "hyd":
      if (value > 5) return { text: "信用恶化", color: "danger" };
      if (value < 3.5) return { text: "信用良好", color: "success" };
      return { text: "信用中性", color: "neutral" };
    case "stress":
      if (value < 0) return { text: "金融环境宽松", color: "success" };
      if (value > 0) return { text: "压力偏紧", color: "warning" };
      return { text: "压力中性", color: "neutral" };
    case "dxy":
      return { text: "汇率中性", color: "success" };
    case "curve":
      if (value < 0) return { text: "倒挂风险", color: "danger" };
      if (value < 0.5) return { text: "曲线偏平", color: "warning" };
      return { text: "曲线正常", color: "success" };
    case "margin":
      if (value > 0) return { text: "杠杆上升", color: "warning" };
      return { text: "杠杆回落", color: "success" };
    case "buffett":
      if (value >= 100) return { text: "估值扩张区间", color: "warning" };
      return { text: "估值收缩区间", color: "success" };
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
  try {
    const raw = await readFile(CACHE_FILE, "utf8");
    return JSON.parse(raw) as CachedSnapshot;
  } catch {
    return null;
  }
}

async function writeCache(data: CachedSnapshot) {
  await mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(data), "utf8");
}

function isUsableCache(cached: CachedSnapshot | null): cached is CachedSnapshot {
  return Boolean(cached && isCacheCompatible(cached) && hasCompleteMetadata(cached.payload));
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

function hasCompleteMetadata(payload: Payload) {
  const hasRealRateInTier1 = payload.sections.some(
    (section) => section.key === "tier1" && section.cards.some((card) => card.id === "real_rate")
  );

  return hasRealRateInTier1 && payload.sections.every((section) =>
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

function isCacheCompatible(cached: CachedSnapshot) {
  return (cached.version ?? 1) >= CACHE_VERSION;
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

async function buildPayload(): Promise<Payload> {
  const [
    dgs10,
    fedfunds,
    nasdaqcom,
    nasdaq100,
    sp500,
    vxncls,
    vixcls,
    hySpread,
    broadDollar,
    stlfsi4,
    t10y2y,
    dfii10,
    cpiLevel,
    indproLevel,
    gdp,
    marginLevel
  ] = await Promise.all([
    fetchSeries("DGS10"),
    fetchSeries("FEDFUNDS"),
    fetchSeries("NASDAQCOM"),
    fetchSeries("NASDAQ100"),
    fetchSeries("SP500"),
    fetchSeries("VXNCLS"),
    fetchSeries("VIXCLS"),
    fetchSeries("BAMLH0A0HYM2"),
    fetchSeries("DTWEXBGS"),
    fetchSeries("STLFSI4"),
    fetchSeries("T10Y2Y"),
    fetchSeries("DFII10"),
    fetchSeries("CPIAUCSL"),
    fetchSeries("INDPRO"),
    fetchSeries("GDP"),
    fetchSeries("BOGZ1FL663067003Q")
  ]);

  const vxnPoints = vxncls.length > 0 ? vxncls : vixcls;
  const techStrength = ratioSeries(nasdaqcom, sp500);
  const cpiYoy = yoySeries(cpiLevel);
  const indproYoy = yoySeries(indproLevel);
  const marginYoy = yoySeriesByLag(marginLevel, 4);
  const buffett = buffettTrendSeries(sp500, gdp);

  const marketCards: DashboardCard[] = [
    cardFromSeries({
      id: "nasdaq_index",
      name: "纳斯达克指数",
      ticker: "FRED: NASDAQCOM",
      unit: "点",
      updateFrequency: "每日",
      shortDescription: "美国科技股整体趋势基准",
      detailDescription: "纳斯达克综合指数实时走势，反映美国科技股整体表现。",
      formula: "直接读取 (纳斯达克综合指数)",
      dataRange: "过去90个交易日",
      points: nasdaqcom
    }),
    cardFromSeries({
      id: "nasdaq100_index",
      name: "纳斯达克100",
      ticker: "FRED: NASDAQ100",
      unit: "点",
      updateFrequency: "每日",
      shortDescription: "大科技龙头表现，领先纳指整体",
      detailDescription: "纳斯达克100指数聚焦头部非金融科技公司，代表大盘科技风险偏好。",
      formula: "直接读取 (纳斯达克100指数)",
      dataRange: "过去90个交易日",
      points: nasdaq100
    })
  ];

  const tier1Cards: DashboardCard[] = [
    cardFromSeries({
      id: "dgs10",
      name: "10年期美债收益率",
      ticker: "FRED: DGS10",
      unit: "%",
      updateFrequency: "每日",
      shortDescription: ">4.5% 明显压估值；<4% 估值回暖",
      detailDescription: "10年期美债收益率是无风险利率锚，决定成长股远期现金流折现压力。",
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
      shortDescription: "加息→压制高估值；降息→利好成长股",
      detailDescription: "美联储政策利率，影响流动性与风险资产估值环境。",
      formula: "直接读取",
      dataRange: "过去90个交易日",
      points: fedfunds
    }),
    cardFromSeries({
      id: "tech_strength",
      name: "科技相对强度",
      ticker: "FRED: NASDAQCOM/SP500",
      unit: "比率",
      updateFrequency: "每日",
      shortDescription: "上升=科技领涨；下降=资金转向防御",
      detailDescription: "纳斯达克/标普500比率，衡量科技股相对大盘的表现强弱。",
      formula: "纳斯达克指数 / 标普500指数",
      dataRange: "过去90个交易日",
      points: techStrength
    }),
    cardFromSeries({
      id: "vxn",
      name: "纳指波动率",
      ticker: "FRED: VXNCLS",
      unit: "",
      updateFrequency: "每日",
      shortDescription: "<15乐观；>30恐慌，常为反向买点",
      detailDescription: "反映纳指未来30天预期波动。受限于公开源，当前以VIXCLS作为近似替代。",
      formula: "直接读取（优先VXN，缺失用VIX）",
      dataRange: "过去90个交易日",
      points: vxnPoints
    }),
    cardFromSeries({
      id: "real_rate",
      name: "实际利率（纳指压力表）",
      ticker: "FRED: DFII10",
      unit: "%",
      updateFrequency: "每日",
      shortDescription: ">2%压制估值；<1%有利成长股",
      detailDescription: "10年期实际利率（TIPS）代表通胀调整后的真实融资成本，是科技股估值的重要压力锚。",
      formula: "直接读取 (10年期TIPS实际收益率 DFII10)",
      dataRange: "过去90个交易日",
      points: dfii10
    })
  ];

  const tier2Cards: DashboardCard[] = [
    cardFromSeries({
      id: "hyd",
      name: "高收益债利差",
      ticker: "FRED: BAMLH0A0HYM2",
      unit: "%",
      updateFrequency: "每日",
      shortDescription: "<3.5%健康；>5%信用危险，融资困难",
      detailDescription: "高收益债利差反映信用风险溢价，利差走阔通常对应风险偏好下降。",
      formula: "直接读取 (高收益债利差)",
      dataRange: "过去90个交易日",
      points: hySpread
    }),
    cardFromSeries({
      id: "dxy",
      name: "广义美元指数",
      ticker: "FRED: DTWEXBGS",
      unit: "",
      updateFrequency: "每日",
      shortDescription: "美元强→压跨国企业EPS；美元弱反之",
      detailDescription: "美联储贸易加权美元指数，覆盖主要贸易伙伴货币，基期2006=100。",
      formula: "直接读取 (广义美元指数)",
      dataRange: "过去90个交易日",
      points: broadDollar
    }),
    cardFromSeries({
      id: "stress",
      name: "金融压力指数",
      ticker: "FRED: STLFSI4",
      unit: "",
      updateFrequency: "每周",
      shortDescription: ">0偏紧；<0宽松；急速上升需警惕",
      detailDescription: "圣路易斯联储金融压力指数，反映融资环境松紧与市场波动压力。",
      formula: "直接读取 (金融压力指数 STL)",
      dataRange: "过去90个交易日",
      points: stlfsi4
    }),
    cardFromSeries({
      id: "curve",
      name: "收益率曲线利差",
      ticker: "FRED: T10Y2Y",
      unit: "%",
      updateFrequency: "每日",
      shortDescription: "负值（倒挂）= 衰退预警信号",
      detailDescription: "10Y-2Y收益率曲线利差，倒挂常被视为经济衰退的领先预警。",
      formula: "10年期收益率 - 2年期收益率",
      dataRange: "过去90个交易日",
      points: t10y2y
    })
  ];

  const tier3Cards: DashboardCard[] = [
    cardFromSeries({
      id: "margin",
      name: "融资余额增速",
      ticker: "FRED: BOGZ1FL663067003Q (YoY)",
      unit: "YoY%",
      updateFrequency: "每季度",
      shortDescription: ">30%过热；负增长=市场去杠杆",
      detailDescription: "融资相关序列同比增速，反映市场杠杆扩张或收缩节奏。",
      formula: "同比增速: (本季-去年同季)/去年同季",
      dataRange: "过去20个季度",
      points: lastN(marginYoy, 20)
    }),
    cardFromSeries({
      id: "buffett",
      name: "市场估值指标",
      ticker: "FRED: SP500/GDP",
      unit: "",
      updateFrequency: "每日/季度",
      shortDescription: "趋势上升=估值扩张；关注趋势而非绝对值",
      detailDescription: "基于SP500指数与GDP比值的趋势追踪指标（非真正巴菲特指数）。数值上升表示估值扩张，下降表示估值收缩。",
      formula: "SP500指数 / GDP (趋势追踪)",
      dataRange: "过去90天 (基于3年数据)",
      points: buffett
    }),
    cardFromSeries({
      id: "cpi",
      name: "CPI通胀率",
      ticker: "FRED: CPIAUCSL (YoY)",
      unit: "YoY%",
      updateFrequency: "每月",
      shortDescription: ">3%触发Fed鹰派；<2%可能降息",
      detailDescription: "消费者物价指数同比增速，衡量通胀压力与政策约束程度。",
      formula: "同比增速：（本月-去年同月）/去年同月",
      dataRange: "过去24个月",
      points: cpiYoy
    }),
    cardFromSeries({
      id: "indpro",
      name: "工业生产指数",
      ticker: "FRED: INDPRO (YoY)",
      unit: "YoY%",
      updateFrequency: "每月",
      shortDescription: "负增长 = 经济收缩信号",
      detailDescription: "工业生产指数同比增速，反映制造业景气与实体经济周期位置。",
      formula: "同比增速：（本月-去年同月）/去年同月",
      dataRange: "过去24个月",
      points: indproYoy
    })
  ];

  return {
    source: `https://${SOURCE}`,
    generatedAt: new Date().toISOString(),
    sections: [
      { key: "market", title: "行情速览：指数走势", cards: marketCards },
      { key: "tier1", title: "第一梯队：核心驱动力（资金与锚）", cards: tier1Cards },
      { key: "tier2", title: "第二梯队：市场健康度（风险结构）", cards: tier2Cards },
      { key: "tier3", title: "第三梯队：长期宏观（周期位置）", cards: tier3Cards }
    ]
  };
}

async function triggerRefresh() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const payload = await buildPayload();
      const fetchedAt = new Date().toISOString();
      await writeCache({
        fetchedAt,
        version: CACHE_VERSION,
        payload
      });
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
      console.error("[invest-weather:nasdaq] background refresh failed", error);
    });
    return cacheResponse(cached, { stale: true, refreshing: true });
  }

  try {
    await triggerRefresh();
    const refreshed = await readCache();
    if (isUsableCache(refreshed)) {
      return cacheResponse(refreshed, { refreshed: true });
    }
    return jsonNoStore(
      { error: "Failed to fetch FRED data for nasdaq station" },
      { status: 500 }
    );
  } catch (error) {
    console.error("[invest-weather:nasdaq] refresh failed without cache", error);
    return jsonNoStore(
      { error: "Failed to fetch FRED data for nasdaq station" },
      { status: 500 }
    );
  }
}
