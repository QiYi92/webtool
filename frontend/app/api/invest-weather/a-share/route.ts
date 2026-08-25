import { NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchTencentIndexOhlc } from "@/lib/invest-weather/public-index-ohlc";

type Point = { date: string; value: number };
type OhlcPoint = { timestamp: number; open: number; high: number; low: number; close: number; volume?: number };
type StatusColor = "success" | "warning" | "danger" | "neutral";
type Card = {
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
  intradayHistory?: Point[];
  ohlcHistory?: OhlcPoint[];
};
type Payload = { source: string; generatedAt: string; sections: Array<{ key: string; title: string; cards: Card[] }> };
type Snapshot = { fetchedAt: string; version: number; payload: Payload };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const CACHE_FILE = path.join(process.cwd(), ".cache", "invest-weather", "a-share.json");
const REFRESH_INTERVAL_MINUTES = 30;
const REFRESH_INTERVAL_MS = REFRESH_INTERVAL_MINUTES * 60 * 1000;
const CACHE_VERSION = 5;
let refreshPromise: Promise<void> | null = null;

const indices = [
  { id: "sse", secid: "1.000001", tencentSymbol: "sh000001", code: "000001", name: "上证指数", description: "沪市整体行情的核心宽基指标。" },
  { id: "csi300", secid: "1.000300", tencentSymbol: "sh000300", code: "000300", name: "沪深300", description: "沪深两市大盘蓝筹股的代表指数。" },
  { id: "szse", secid: "0.399001", tencentSymbol: "sz399001", code: "399001", name: "深证成指", description: "深市主要上市公司的综合表现。" },
  { id: "chinext", secid: "0.399006", tencentSymbol: "sz399006", code: "399006", name: "创业板指", description: "A股成长与创新风格的核心温度计。" },
  { id: "star50", secid: "1.000688", tencentSymbol: "sh000688", code: "000688", name: "科创50", description: "科创板龙头公司的整体表现。" },
  { id: "csi500", secid: "1.000905", tencentSymbol: "sh000905", code: "000905", name: "中证500", description: "A股中盘风格的代表指数。" },
  { id: "csi1000", secid: "1.000852", tencentSymbol: "sh000852", code: "000852", name: "中证1000", description: "A股小盘风格与市场活跃度的代表指数。" },
  { id: "csi_dividend", secid: "1.000922", tencentSymbol: "sh000922", code: "000922", name: "中证红利", description: "高股息防御风格的代表指数。" }
] as const;

function jsonNoStore(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

async function fetchKlines(secid: string): Promise<OhlcPoint[]> {
  const params = new URLSearchParams({
    secid,
    klt: "101",
    fqt: "1",
    lmt: "4000",
    end: "20500000",
    fields1: "f1,f2,f3,f4,f5,f6,f7,f8",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
    ut: "f057cbcbce2a86e2866ab8877db1d059"
  });
  const response = await fetch(`https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`, {
    cache: "no-store",
    headers: { Referer: "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" }
  });
  if (!response.ok) throw new Error(`Eastmoney kline ${secid}: ${response.status}`);
  const body = (await response.json()) as { data?: { klines?: string[] } };
  return (body.data?.klines ?? []).flatMap((row) => {
    const [date, openRaw, closeRaw, highRaw, lowRaw, volumeRaw] = row.split(",");
    const timestamp = new Date(`${date}T00:00:00+08:00`).getTime();
    const open = Number(openRaw); const close = Number(closeRaw); const high = Number(highRaw); const low = Number(lowRaw);
    const volume = Number(volumeRaw);
    return date && Number.isFinite(timestamp) && [open, close, high, low].every(Number.isFinite)
      ? [{ timestamp, open, high, low, close, ...(Number.isFinite(volume) ? { volume } : {}) }]
      : [];
  });
}

async function fetchIntraday(secid: string): Promise<Point[]> {
  const params = new URLSearchParams({
    secid,
    ndays: "1",
    iscca: "1",
    fields1: "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58",
    ut: "f057cbcbce2a86e2866ab8877db1d059"
  });
  const response = await fetch(`https://push2his.eastmoney.com/api/qt/stock/trends2/get?${params}`, {
    cache: "no-store",
    headers: { Referer: "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" }
  });
  if (!response.ok) return [];
  const body = (await response.json()) as { data?: { trends?: string[] } };
  return (body.data?.trends ?? []).flatMap((row) => {
    const [date, price] = row.split(",");
    const value = Number(price);
    return date && Number.isFinite(value) ? [{ date, value }] : [];
  });
}

function makeCard(meta: (typeof indices)[number], ohlcHistory: OhlcPoint[], intradayHistory: Point[]): Card {
  const history = ohlcHistory.map((item) => ({
    date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(item.timestamp)),
    value: item.close
  }));
  const current = history.at(-1) ?? null;
  const previous = history.at(-2) ?? null;
  const change = current && previous && previous.value !== 0 ? (current.value / previous.value - 1) * 100 : null;
  let status: { text: string; color: StatusColor } = { text: "窄幅震荡", color: "neutral" };
  if (change !== null && change >= 1) status = { text: "明显走强", color: "success" };
  else if (change !== null && change > 0) status = { text: "温和上涨", color: "success" };
  else if (change !== null && change <= -1) status = { text: "明显走弱", color: "danger" };
  else if (change !== null && change < 0) status = { text: "温和回落", color: "warning" };
  return {
    id: meta.id,
    name: meta.name,
    ticker: `EM: ${meta.code}`,
    value: current?.value ?? null,
    unit: "点",
    secondaryValue: change,
    dataDate: current?.date ?? null,
    updateFrequency: "每日",
    statusText: status.text,
    statusColor: status.color,
    shortDescription: meta.description,
    detailDescription: `${meta.description}当前状态按最近两个交易日的收盘点位变化判定。`,
    formula: "日涨跌幅 = 最新收盘点位 / 前一交易日收盘点位 - 1",
    dataRange: "过去180个交易日",
    history: history.slice(-180),
    intradayHistory,
    ohlcHistory
  };
}

async function buildPayload(): Promise<Payload> {
  const [histories, intradayHistories] = await Promise.all([
    Promise.all(indices.map((item) => fetchTencentIndexOhlc(item.tencentSymbol).catch(() => fetchKlines(item.secid)))),
    Promise.all(indices.map((item) => fetchIntraday(item.secid).catch(() => [])))
  ]);
  const cards = indices.map((item, index) => makeCard(item, histories[index], intradayHistories[index]));
  return {
    source: "东方财富公开行情接口",
    generatedAt: new Date().toISOString(),
    sections: [
      { key: "market", title: "核心宽基：沪深市场整体温度", cards: cards.slice(0, 4) },
      { key: "style", title: "市场风格：科技、中盘、小盘与红利", cards: cards.slice(4) }
    ]
  };
}

async function readCache() {
  try { return JSON.parse(await readFile(CACHE_FILE, "utf8")) as Snapshot; } catch { return null; }
}
async function writeCache(snapshot: Snapshot) {
  await mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(snapshot), "utf8");
}
function responseFrom(snapshot: Snapshot, stale = false) {
  return jsonNoStore({
    ...snapshot.payload,
    lastUpdatedAt: snapshot.fetchedAt,
    cache: { stale, fetchedAt: snapshot.fetchedAt, refreshIntervalMinutes: REFRESH_INTERVAL_MINUTES }
  });
}
async function refresh() {
  if (!refreshPromise) {
    refreshPromise = buildPayload()
      .then((payload) => writeCache({ fetchedAt: new Date().toISOString(), version: CACHE_VERSION, payload }))
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export async function GET() {
  const cached = await readCache();
  const age = cached ? Date.now() - new Date(cached.fetchedAt).getTime() : Number.POSITIVE_INFINITY;
  if (cached?.version === CACHE_VERSION && age < REFRESH_INTERVAL_MS) return responseFrom(cached);
  if (cached?.version === CACHE_VERSION) {
    void refresh().catch((error) => console.error("[invest-weather:a-share] background refresh failed", error));
    return responseFrom(cached, true);
  }
  try {
    await refresh();
    const fresh = await readCache();
    return fresh ? responseFrom(fresh) : jsonNoStore({ error: "Failed to build A-share weather station" }, { status: 500 });
  } catch (error) {
    console.error("[invest-weather:a-share] refresh failed", error);
    if (cached) return responseFrom(cached, true);
    return jsonNoStore({ error: "Failed to fetch A-share market data" }, { status: 500 });
  }
}
