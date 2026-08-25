export type OhlcPoint = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

function parseRow(row: string[]): OhlcPoint | null {
  const [date, openRaw, closeRaw, highRaw, lowRaw, volumeRaw] = row;
  const timestamp = new Date(`${date}T12:00:00Z`).getTime();
  const open = Number(openRaw); const close = Number(closeRaw); const high = Number(highRaw); const low = Number(lowRaw);
  const volume = Number(volumeRaw);
  if (!date || !Number.isFinite(timestamp) || ![open, close, high, low].every(Number.isFinite)) return null;
  return { timestamp, open, high, low, close, ...(Number.isFinite(volume) ? { volume } : {}) };
}

async function fetchTencentChunk(symbol: string, endDate = ""): Promise<OhlcPoint[]> {
  const params = new URLSearchParams({ param: `${symbol},day,,${endDate},2000,qfq` });
  const response = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?${params}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
    headers: { Referer: "https://gu.qq.com/", "User-Agent": "Mozilla/5.0" }
  });
  if (!response.ok) throw new Error(`Tencent OHLC ${symbol}: ${response.status}`);
  const body = (await response.json()) as { data?: Record<string, { day?: string[][] }> };
  const points = (body.data?.[symbol]?.day ?? []).flatMap((row) => {
    const point = parseRow(row);
    return point ? [point] : [];
  });
  if (points.length === 0) throw new Error(`Tencent OHLC ${symbol}: empty data`);
  return points;
}

export async function fetchTencentIndexOhlc(symbol: string): Promise<OhlcPoint[]> {
  const recent = await fetchTencentChunk(symbol);
  const oldestDate = new Date(recent[0].timestamp).toISOString().slice(0, 10);
  const older = await fetchTencentChunk(symbol, oldestDate);
  const merged = new Map<number, OhlcPoint>();
  for (const point of [...older, ...recent]) merged.set(point.timestamp, point);
  return Array.from(merged.values()).sort((a, b) => a.timestamp - b.timestamp);
}

async function fetchEastmoneyOhlc(secid: string, limit: number): Promise<OhlcPoint[]> {
  const params = new URLSearchParams({
    secid, klt: "101", fqt: "1", lmt: String(limit), end: "20500000", iscca: "1",
    fields1: "f1,f2,f3,f4,f5,f6,f7,f8",
    fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
    ut: "f057cbcbce2a86e2866ab8877db1d059"
  });
  const response = await fetch(`https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
    headers: { Referer: "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" }
  });
  if (!response.ok) throw new Error(`Eastmoney OHLC ${secid}: ${response.status}`);
  const body = (await response.json()) as { data?: { klines?: string[] } };
  const points = (body.data?.klines ?? []).flatMap((row) => {
    const point = parseRow(row.split(","));
    return point ? [point] : [];
  });
  if (points.length === 0) throw new Error(`Eastmoney OHLC ${secid}: empty data`);
  return points;
}

export async function fetchPublicIndexOhlc(input: { tencentSymbol: string; eastmoneySecid: string }) {
  try {
    return await fetchTencentIndexOhlc(input.tencentSymbol);
  } catch (tencentError) {
    console.warn(`[invest-weather:ohlc] Tencent ${input.tencentSymbol} unavailable`, tencentError);
    return fetchEastmoneyOhlc(input.eastmoneySecid, 4000);
  }
}
