import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

type HistoryPoint = {
  date: string;
  value: number;
};

type RelationItem = {
  type?: string;
  name?: string;
  level?: number;
  typeVal?: string;
  index?: number;
  riseFallDiff?: number;
  riseFallRate?: number;
  trendList?: Array<[number | string, number | string]>;
};

type RelationResponse = {
  success: boolean;
  data?: RelationItem[];
};

type TrendResponse = {
  success: boolean;
  data?: {
    trendList?: Array<[number | string, number | string, number | string]>;
  };
};

type SkinListItem = {
  name?: string;
  imageUrl?: string;
  marketHashName?: string;
  price?: number | string;
  priceDiff?: number | string;
  priceRate?: number | string;
};

type SkinListResponse = {
  success: boolean;
  data?: {
    list?: SkinListItem[];
  };
};

type ComponentItem = {
  name: string;
  imageUrl: string;
  marketHashName: string;
  price: number | null;
  priceDiff: number | null;
  priceRate: number | null;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const API_BASE = "https://api.steamdt.com";
const FETCH_TIMEOUT_MS = 5000;
const CURL_TIMEOUT_SECONDS = 8;
const REQUEST_HEADERS = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
};
const execFileAsync = promisify(execFile);

function jsonNoStore(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init?.headers ?? {})
    }
  });
}

function toNumber(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toHistoryPoints(
  pairs: Array<[number | string, number | string]> | undefined,
  valueIndex = 1
): HistoryPoint[] {
  return (pairs ?? [])
    .map((pair) => {
      const rawTime = pair[0];
      const rawValue = pair[valueIndex];
      const timestamp = typeof rawTime === "string" ? Number(rawTime) : rawTime;
      const value = toNumber(rawValue);
      if (!Number.isFinite(timestamp) || value === null) return null;
      return {
        date: new Date(timestamp * 1000).toISOString(),
        value
      };
    })
    .filter((point): point is HistoryPoint => point !== null);
}

async function curlJson<T>(url: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
  const args = [
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
    ...(init?.method ? ["--request", init.method] : []),
    ...(init?.body !== undefined
      ? ["--header", "Content-Type: application/json", "--data", JSON.stringify(init.body)]
      : []),
    url
  ];
  const { stdout } = await execFileAsync("curl", args);
  return JSON.parse(stdout) as T;
}

async function fetchJson<T>(
  pathname: string,
  init?: {
    method?: "GET" | "POST";
    body?: unknown;
  }
): Promise<T> {
  const url = `${API_BASE}${pathname}`;
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        ...REQUEST_HEADERS,
        ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {})
      },
      method: init?.method ?? "GET",
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${pathname}: ${response.status}`);
    }
    return (await response.json()) as T;
  } catch {
    return curlJson<T>(url, init);
  }
}

function normalizeComponents(response: SkinListResponse | null): ComponentItem[] {
  return (response?.success ? response.data?.list ?? [] : []).slice(0, 10).map((item) => ({
    name: item.name ?? "--",
    imageUrl: item.imageUrl ?? "",
    marketHashName: item.marketHashName ?? "",
    price: toNumber(item.price),
    priceDiff: toNumber(item.priceDiff),
    priceRate: toNumber(item.priceRate)
  }));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const typeVal = searchParams.get("typeVal");
  const level = Number(searchParams.get("level"));

  if (!type || !typeVal || !Number.isFinite(level)) {
    return jsonNoStore({ error: "Missing required params" }, { status: 400 });
  }

  try {
    const relationBody = {
      type,
      level,
      platform: "ALL",
      typeVal,
      typeDay: "1"
    };

    const skinListBody = {
      type,
      level,
      typeVal,
      platform: "ALL",
      pageSize: 10,
      nextId: "",
      queryName: "",
      dataField: "priceRate",
      dataRange: "ONE_DAY"
    };

    const [relationResponse, trendResponse, skinListUpResponse, skinListDownResponse] = await Promise.all([
      fetchJson<RelationResponse>("/user/item/block/v1/relation", {
        method: "POST",
        body: relationBody
      }),
      fetchJson<TrendResponse>("/user/item/block/v1/trend", {
        method: "POST",
        body: {
          ...relationBody,
          dateType: 3
        }
      }).catch(() => null),
      fetchJson<SkinListResponse>("/user/item/block/v1/skin-list", {
        method: "POST",
        body: {
          ...skinListBody,
          sortType: "DESC"
        }
      }).catch(() => null),
      fetchJson<SkinListResponse>("/user/item/block/v1/skin-list", {
        method: "POST",
        body: {
          ...skinListBody,
          sortType: "ASC"
        }
      }).catch(() => null)
    ]);

    if (!relationResponse.success || !relationResponse.data) {
      return jsonNoStore({ error: "Failed to fetch relation data" }, { status: 502 });
    }

    const relationItem = relationResponse.data.find((item) => item.typeVal === typeVal);
    if (!relationItem) {
      return jsonNoStore({ error: "Block item not found" }, { status: 404 });
    }

    const fallbackPriceHistory = toHistoryPoints(relationItem.trendList);
    const trendList = trendResponse?.success ? trendResponse.data?.trendList : null;
    const priceHistory =
      trendList && trendList.length > 1
        ? toHistoryPoints(
            trendList.map((item) => [item[0], item[1]])
          )
        : fallbackPriceHistory;
    const sellCountHistory =
      trendList && trendList.length > 1
        ? toHistoryPoints(
            trendList.map((item) => [item[0], item[2]])
          )
        : [];

    const currentIndex = toNumber(relationItem.index);
    const riseFallDiff = toNumber(relationItem.riseFallDiff);
    const riseFallRate = toNumber(relationItem.riseFallRate);
    const yesterdayIndex =
      currentIndex !== null && riseFallDiff !== null ? currentIndex - riseFallDiff : null;
    const historyValues = priceHistory.map((item) => item.value);
    const highIndex = historyValues.length > 0 ? Math.max(...historyValues) : null;
    const lowIndex = historyValues.length > 0 ? Math.min(...historyValues) : null;
    const updateTime = priceHistory.length > 0 ? priceHistory[priceHistory.length - 1]?.date ?? null : null;

    return jsonNoStore({
      name: relationItem.name ?? "--",
      type,
      typeVal,
      level,
      currentIndex,
      yesterdayIndex,
      highIndex,
      lowIndex,
      riseFallDiff,
      riseFallRate,
      updateTime,
      priceHistory,
      sellCountHistory,
      components: normalizeComponents(skinListUpResponse),
      componentsUp: normalizeComponents(skinListUpResponse),
      componentsDown: normalizeComponents(skinListDownResponse),
      trendSourceAvailable: Boolean(trendList && trendList.length > 1)
    });
  } catch (error) {
    console.error("[invest-weather:cs2:block-detail] failed", error);
    return jsonNoStore({ error: "Failed to fetch block detail" }, { status: 500 });
  }
}
