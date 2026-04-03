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
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SOURCE = "fred.stlouisfed.org/graph/fredgraph.csv";
const FRED_API_SOURCE = "api.stlouisfed.org/fred/series/observations";
const FRED_API_KEY = process.env.FRED_API_KEY?.trim();
const CACHE_FILE = path.join(process.cwd(), ".cache", "invest-weather", "hk.json");
const REFRESH_INTERVAL_MINUTES = 30;
const REFRESH_INTERVAL_MS = REFRESH_INTERVAL_MINUTES * 60 * 1000;
const CACHE_VERSION = 1;
let refreshPromise: Promise<void> | null = null;

const ETF_PROXY = {
  secid: "1.520890",
  code: "520890",
  name: "港股通红利低波ETF"
} as const;

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

async function fetchEastmoneyKlines(input: {
  secid: string;
  limit?: number;
  fqt?: string;
}): Promise<Point[]> {
  const params = new URLSearchParams({
    secid: input.secid,
    klt: "101",
    fqt: input.fqt ?? "1",
    lmt: String(input.limit ?? 1000),
    end: "20500000",
    iscca: "1",
    fields1: "f1,f2,f3,f4,f5,f6,f7,f8",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64",
    ut: "f057cbcbce2a86e2866ab8877db1d059",
    forcect: "1"
  });
  const response = await fetch(`https://push2his.eastmoney.com/api/qt/stock/kline/get?${params.toString()}`, {
    cache: "no-store",
    headers: {
      Referer: "https://quote.eastmoney.com/",
      "User-Agent": "Mozilla/5.0"
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch eastmoney kline ${input.secid}: ${response.status}`);
  }
  const data = (await response.json()) as {
    data?: { klines?: string[] };
  };
  const rows = Array.isArray(data.data?.klines) ? data.data.klines : [];
  const out: Point[] = [];
  for (const row of rows) {
    const [date, open, latest] = row.split(",");
    const value = Number(latest ?? open);
    if (!date || !Number.isFinite(value)) continue;
    out.push({ date, value });
  }
  return out;
}

async function fetchSouthboundSeries(): Promise<Point[]> {
  const params = new URLSearchParams({
    fields1: "f1,f2,f3,f4",
    fields2: "f51,f54,f52,f58,f53,f62,f56,f57,f60,f61",
    ut: "b2884a393a59ad64002292a3e90d46a5",
    _: Date.now().toString()
  });
  const response = await fetch(`https://push2.eastmoney.com/api/qt/kamtbs.rtmin/get?${params.toString()}`, {
    cache: "no-store",
    headers: {
      Referer: "https://data.eastmoney.com/",
      "User-Agent": "Mozilla/5.0"
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch southbound flow: ${response.status}`);
  }
  const data = (await response.json()) as {
    data?: {
      n2s?: string[];
      n2sDate?: string;
    };
  };
  const rows = Array.isArray(data.data?.n2s) ? data.data.n2s : [];
  const date = data.data?.n2sDate;
  if (!date) return [];
  const out: Point[] = [];
  for (const row of rows) {
    const columns = row.split(",");
    const time = columns[0];
    const value = Number(columns[5]);
    if (!time || !Number.isFinite(value)) continue;
    out.push({ date: `${date} ${time}`, value });
  }
  return out;
}

function latest(points: Point[]) { return points.length ? points[points.length - 1] : null; }
function prev(points: Point[]) { return points.length > 1 ? points[points.length - 2] : null; }
function lastN(points: Point[], n: number) { return points.slice(Math.max(0, points.length - n)); }

function pctChange(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) return null;
  return (current / previous - 1) * 100;
}

function ratioSeries(a: Point[], b: Point[]) {
  const bMap = new Map(b.map((item) => [item.date, item.value]));
  const out: Point[] = [];
  for (const point of a) {
    const denominator = bMap.get(point.date);
    if (denominator === undefined || denominator === 0) continue;
    out.push({ date: point.date, value: point.value / denominator });
  }
  return out;
}

function derive20DayPct(points: Point[]) {
  if (points.length < 21) return null;
  const current = points[points.length - 1]?.value ?? null;
  const previous = points[points.length - 21]?.value ?? null;
  return pctChange(current, previous);
}

function normalizeUsdHkd(points: Point[]) {
  return points.filter((item) => item.value > 0 && Number.isFinite(item.value));
}

function getStatusForCard(id: string, value: number | null, secondaryValue: number | null): { text: string; color: StatusColor } {
  if (value === null) return { text: "数据缺失", color: "neutral" };
  switch (id) {
    case "hsi_index":
      if (secondaryValue !== null) {
        if (secondaryValue > 0.3) return { text: "风险偏好回升", color: "success" };
        if (secondaryValue < -0.3) return { text: "风险偏好回落", color: "warning" };
      }
      return { text: "市场震荡", color: "neutral" };
    case "hstech_index":
      if (secondaryValue !== null) {
        if (secondaryValue > 0.5) return { text: "成长风格回暖", color: "success" };
        if (secondaryValue < -0.5) return { text: "成长风格承压", color: "warning" };
      }
      return { text: "成长风格震荡", color: "neutral" };
    case "hk_dividend_lowvol":
      if (secondaryValue !== null) {
        if (secondaryValue > 0.3) return { text: "红利防御走强", color: "success" };
        if (secondaryValue < -0.3) return { text: "红利防御走弱", color: "warning" };
      }
      return { text: "防御风格稳定", color: "neutral" };
    case "hk_style_rotation":
      if (secondaryValue !== null) {
        if (secondaryValue < -8) return { text: "防御显著占优", color: "danger" };
        if (secondaryValue < -3) return { text: "市场转向防守", color: "warning" };
        if (secondaryValue > 3) return { text: "成长风格占优", color: "success" };
      }
      return { text: "风格均衡", color: "neutral" };
    case "hk_dxy":
      if (value > 128) return { text: "美元偏强", color: "warning" };
      if (value < 120) return { text: "汇率压力缓和", color: "success" };
      return { text: "美元中性", color: "neutral" };
    case "hk_dgs10":
      if (value > 4.5) return { text: "估值承压", color: "warning" };
      if (value < 4.0) return { text: "估值回暖", color: "success" };
      return { text: "中性区间", color: "neutral" };
    case "hk_real_yield":
      if (value > 2.0) return { text: "真实利率过高", color: "danger" };
      if (value < 1.0) return { text: "对成长友好", color: "success" };
      return { text: "中性偏紧", color: "yellow" };
    case "hk_curve":
      if (value < 0) return { text: "衰退预警", color: "danger" };
      if (value > 0.5) return { text: "曲线正常", color: "success" };
      return { text: "修复早期", color: "neutral" };
    case "hk_fci":
      if (value > 0.25) return { text: "流动性偏紧", color: "warning" };
      if (value < -0.25) return { text: "流动性宽松", color: "success" };
      return { text: "金融条件中性", color: "neutral" };
    case "usd_hkd":
      if (value >= 7.84) return { text: "接近弱方区间", color: "warning" };
      if (value < 7.8) return { text: "港元偏强", color: "success" };
      return { text: "联系汇率常态", color: "neutral" };
    case "southbound_flow":
      if (value < -50) return { text: "南向明显流出", color: "danger" };
      if (value < 0) return { text: "南向净流出", color: "warning" };
      if (value > 50) return { text: "南向明显加仓", color: "success" };
      return { text: "轻度净流入", color: "neutral" };
    default:
      return { text: "中性", color: "neutral" };
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
  secondaryValueOverride?: number | null;
  historyLimit?: number;
}) {
  const latestPoint = latest(input.points);
  const prevPoint = prev(input.points);
  const value = latestPoint?.value ?? null;
  const secondaryValue = input.secondaryValueOverride ?? pctChange(latestPoint?.value ?? null, prevPoint?.value ?? null);
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
    history: lastN(input.points, input.historyLimit ?? 90)
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
  const [
    hsi,
    hstech,
    hshylvResult,
    dxy,
    dgs10,
    realYield,
    curve,
    fci,
    usdHkd,
    southbound
  ] = await Promise.all([
    fetchEastmoneyKlines({ secid: "100.HSI", limit: 160 }),
    fetchEastmoneyKlines({ secid: "124.HSTECH", limit: 160 }),
    (async () => {
      try {
        const points = await fetchEastmoneyKlines({ secid: "124.HSHYLV", limit: 160 });
        return {
          points,
          ticker: "EM: HSHYLV",
          shortDescription: "恒生港股通高股息低波动指数",
          detailDescription: "官方指数 HSHYLV，反映港股通范围内高股息、低波动风格。",
          formula: "直接读取 HSHYLV 指数日线",
          dataRange: "过去90个交易日"
        };
      } catch (error) {
        console.warn("[invest-weather:hk] HSHYLV unavailable, fallback to ETF proxy", error);
        const points = await fetchEastmoneyKlines({ secid: ETF_PROXY.secid, limit: 160, fqt: "1" });
        return {
          points,
          ticker: `ETF Proxy: ${ETF_PROXY.code}`,
          shortDescription: "HSHYLV 失败时自动切到港股通红利低波ETF代理",
          detailDescription: "当前环境未能稳定获取 HSHYLV 指数，使用港股通红利低波ETF(520890) 作为风格代理，展示时需明确代理口径。",
          formula: "优先 HSHYLV；失败时回退至 ETF 520890 日线",
          dataRange: "过去90个交易日"
        };
      }
    })(),
    fetchSeries("DTWEXBGS"),
    fetchSeries("DGS10"),
    fetchSeries("DFII10"),
    fetchSeries("T10Y2Y"),
    fetchSeries("NFCI"),
    fetchSeries("DEXHKUS").then(normalizeUsdHkd),
    fetchSouthboundSeries()
  ]);

  const styleRotation = ratioSeries(hstech, hshylvResult.points);
  const styleRotationSecondary = derive20DayPct(styleRotation);

  const marketCards: DashboardCard[] = [
    cardFromSeries({
      id: "hsi_index",
      name: "恒生指数",
      ticker: "EM: HSI",
      unit: "点",
      updateFrequency: "每日",
      shortDescription: "港股核心宽基，反映市场整体风险偏好",
      detailDescription: "恒生指数是港股整体温度的最核心观察项，兼具中资金融、互联网平台与周期板块权重。",
      formula: "直接读取恒生指数日线",
      dataRange: "过去90个交易日",
      points: hsi
    }),
    cardFromSeries({
      id: "hstech_index",
      name: "恒生科技指数",
      ticker: "EM: HSTECH",
      unit: "点",
      updateFrequency: "每日",
      shortDescription: "港股成长风格温度计",
      detailDescription: "恒生科技指数代表互联网平台、消费科技与创新成长方向，对美债利率和美元更敏感。",
      formula: "直接读取恒生科技指数日线",
      dataRange: "过去90个交易日",
      points: hstech
    })
  ];

  const styleCards: DashboardCard[] = [
    cardFromSeries({
      id: "hk_dividend_lowvol",
      name: "恒生红利低波",
      ticker: hshylvResult.ticker,
      unit: "点",
      updateFrequency: "每日",
      shortDescription: hshylvResult.shortDescription,
      detailDescription: hshylvResult.detailDescription,
      formula: hshylvResult.formula,
      dataRange: hshylvResult.dataRange,
      points: hshylvResult.points
    }),
    cardFromSeries({
      id: "hk_style_rotation",
      name: "港股风格轮动比值",
      ticker: "HSTECH / HSHYLV",
      unit: "比值",
      updateFrequency: "每日",
      shortDescription: "成长相对红利低波的强弱切换",
      detailDescription: "用恒生科技指数除以红利低波指数，识别港股当前偏进攻还是偏防守。若 HSHYLV 不可得，则自动沿用 ETF 代理口径计算。",
      formula: "风格比值 = 恒生科技指数 / 红利低波指数；状态取近20个交易日变化",
      dataRange: "过去90个交易日",
      points: styleRotation,
      secondaryValueOverride: styleRotationSecondary
    })
  ];

  const macroCards: DashboardCard[] = [
    cardFromSeries({
      id: "hk_dxy",
      name: "美元指数",
      ticker: "FRED: DTWEXBGS",
      unit: "",
      updateFrequency: "每日",
      shortDescription: "美元走强通常压制港股估值",
      detailDescription: "港股在全球美元体系中定价，美元走强常对应外部流动性压力和风险偏好回落。",
      formula: "直接读取广义美元指数",
      dataRange: "过去90个交易日",
      points: dxy
    }),
    cardFromSeries({
      id: "hk_dgs10",
      name: "10年期美债收益率",
      ticker: "FRED: DGS10",
      unit: "%",
      updateFrequency: "每日",
      shortDescription: "长端利率上行会压制港股估值",
      detailDescription: "港股成长和高分红资产都受全球无风险利率影响，其中成长风格更敏感。",
      formula: "直接读取10年期美债收益率",
      dataRange: "过去90个交易日",
      points: dgs10
    }),
    cardFromSeries({
      id: "hk_real_yield",
      name: "10年期实际利率",
      ticker: "FRED: DFII10",
      unit: "%",
      updateFrequency: "每日",
      shortDescription: "真实利率决定成长股贴现压力",
      detailDescription: "10年期实际利率越高，成长资产估值折现越重，对恒生科技压制越明显。",
      formula: "直接读取10年期 TIPS 实际收益率",
      dataRange: "过去90个交易日",
      points: realYield
    }),
    cardFromSeries({
      id: "hk_curve",
      name: "10Y-2Y 利差",
      ticker: "FRED: T10Y2Y",
      unit: "%",
      updateFrequency: "每日",
      shortDescription: "曲线倒挂常对应衰退预期",
      detailDescription: "美国收益率曲线反映全球增长预期和风险偏好，港股对这一信号较敏感。",
      formula: "10年期国债收益率 - 2年期国债收益率",
      dataRange: "过去90个交易日",
      points: curve
    }),
    cardFromSeries({
      id: "hk_fci",
      name: "美国金融条件",
      ticker: "FRED: NFCI",
      unit: "",
      updateFrequency: "每周",
      shortDescription: "金融条件越紧，港股承压概率越大",
      detailDescription: "芝加哥联储 NFCI 反映美国整体融资与信用环境，是全球风险资产外部流动性的一个压缩表达。",
      formula: "直接读取 NFCI",
      dataRange: "过去90周",
      points: fci
    })
  ];

  const flowCards: DashboardCard[] = [
    cardFromSeries({
      id: "usd_hkd",
      name: "港元兑美元",
      ticker: "FRED: DEXHKUS",
      unit: "HKD/USD",
      updateFrequency: "每日",
      shortDescription: "靠近弱方区间时往往意味着流动性偏紧",
      detailDescription: "联系汇率制度下，港元若长期停留在弱方附近，通常意味着本地流动性条件偏紧。",
      formula: "直接读取港元兑美元日线",
      dataRange: "过去90个交易日",
      points: usdHkd
    }),
    cardFromSeries({
      id: "southbound_flow",
      name: "南向资金",
      ticker: "EM: Southbound Flow",
      unit: "亿港元",
      updateFrequency: "日内",
      shortDescription: "衡量内地资金是否持续买入港股",
      detailDescription: "使用东财南向资金分时累计净流入作为边际资金温度计，更适合观察当日资金态度而不是长期趋势。",
      formula: "直接读取南向资金日内累计净流入",
      dataRange: "当日分时",
      points: southbound,
      secondaryValueOverride: null,
      historyLimit: 120
    })
  ];

  return {
    source: "FRED + Eastmoney public endpoints",
    generatedAt: new Date().toISOString(),
    sections: [
      { key: "market", title: "市场温度：港股主指数", cards: marketCards },
      { key: "style", title: "风格对照：成长 vs 红利低波", cards: styleCards },
      { key: "macro", title: "外部宏观：美元、利率与金融条件", cards: macroCards },
      { key: "flow", title: "本地资金：汇率与南向资金", cards: flowCards }
    ]
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
      console.error("[invest-weather:hk] background refresh failed", error);
    });
    return cacheResponse(cached, { stale: true, refreshing: true });
  }

  try {
    await triggerRefresh();
    const refreshed = await readCache();
    if (isUsableCache(refreshed)) {
      return cacheResponse(refreshed, { refreshed: true });
    }
    return jsonNoStore({ error: "Failed to fetch data for Hong Kong weather station" }, { status: 500 });
  } catch (error) {
    console.error("[invest-weather:hk] refresh failed without cache", error);
    return jsonNoStore({ error: "Failed to fetch data for Hong Kong weather station" }, { status: 500 });
  }
}
