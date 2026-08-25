"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, ChevronRight, Clock3, ExternalLink, TrendingUp, X } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { AuthGuard } from "@/components/AuthGuard";
import { buttonVariants } from "@/components/ui/button";
import { ProfessionalMarketChart, type ProfessionalChartPoint } from "@/components/invest-weather/ProfessionalMarketChart";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";

type HistoryItem = {
  date: string;
  value: number;
};

type OhlcHistoryItem = ProfessionalChartPoint;

type ChartPeriod = "intraday" | "daily" | "weekly" | "monthly";

const chartPeriodOptions: Array<{ key: ChartPeriod; label: string }> = [
  { key: "intraday", label: "当日" },
  { key: "daily", label: "日 K" },
  { key: "weekly", label: "周 K" },
  { key: "monthly", label: "月 K" }
];

type DashboardCard = {
  id: string;
  name: string;
  ticker: string;
  value: number | null;
  unit: string;
  secondaryValue: number | null;
  dataDate: string | null;
  updateFrequency: string | null;
  statusText: string | null;
  statusColor: "success" | "warning" | "danger" | "neutral" | "yellow" | null;
  shortDescription: string | null;
  detailDescription: string;
  formula: string;
  dataRange: string;
  history: HistoryItem[] | null;
  intradayHistory?: HistoryItem[] | null;
  ohlcHistory?: OhlcHistoryItem[] | null;
};

type DashboardSection = {
  key: string;
  title: string;
  cards: DashboardCard[];
};

type WeatherResponse = {
  generatedAt: string;
  lastUpdatedAt?: string;
  cache?: {
    refreshIntervalMinutes?: number;
  };
  sections: DashboardSection[];
};

export type MarketWeatherDashboardConfig = {
  title: string;
  apiPath: string;
  sourceLabel: string;
  sourceFooter: string;
  sourceLinks: Record<string, string>;
  loadingText?: string;
  featuredSectionKeys?: string[];
};

const statusColorMap: Record<string, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  yellow: "border-amber-200 bg-amber-50 text-amber-700",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
  neutral: "border-slate-200 bg-slate-100 text-slate-600"
};

const valueColorMap: Record<string, string> = {
  success: "text-emerald-500",
  warning: "text-amber-500",
  yellow: "text-amber-500",
  danger: "text-rose-500",
  neutral: "text-slate-700"
};

const sparklineColorMap: Record<string, string> = {
  success: "stroke-emerald-500",
  warning: "stroke-amber-500",
  yellow: "stroke-amber-500",
  danger: "stroke-rose-500",
  neutral: "stroke-slate-400"
};

function formatValue(value: number | null, unit: string) {
  if (value === null || Number.isNaN(value)) return "--";
  if (Math.abs(value) >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (unit.toLowerCase().includes("yoy")) return value.toFixed(2);
  if (unit === "%" || unit === "比率") return value.toFixed(2);
  return value.toFixed(2);
}

function formatChange(change: number | null) {
  if (change === null || Number.isNaN(change)) return "%";
  const sign = change > 0 ? "+" : "";
  return `${sign}${change.toFixed(2)}%`;
}

function formatDate(date: string | null) {
  if (!date) return "--";
  return date;
}

function formatDateWithWeekday(date: string | null) {
  if (!date) return "--";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long"
  }).format(parsed);
}

function formatDateTime(date: string | null | undefined) {
  if (!date) return "--";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(parsed);
}

function cardStats(history: HistoryItem[]) {
  if (history.length === 0) {
    return {
      min: null as number | null,
      max: null as number | null,
      avg: null as number | null,
      rangePct: null as number | null
    };
  }
  const values = history.map((item) => item.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((sum, current) => sum + current, 0) / values.length;
  const first = values[0];
  const last = values[values.length - 1];
  const rangePct = first !== 0 ? (last / first - 1) * 100 : null;
  return { min, max, avg, rangePct };
}

function aggregateHistory(history: HistoryItem[], period: Exclude<ChartPeriod, "intraday">) {
  if (history.length === 0 || period === "daily") return history.slice(-180);

  const grouped = new Map<string, HistoryItem>();
  for (const item of history) {
    const normalized = item.date.includes(" ") ? item.date.replace(" ", "T") : `${item.date}T00:00:00`;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) continue;
    let key: string;
    if (period === "monthly") {
      key = `${date.getFullYear()}-${date.getMonth() + 1}`;
    } else {
      const monday = new Date(date);
      const day = monday.getDay() || 7;
      monday.setDate(monday.getDate() - day + 1);
      key = `${monday.getFullYear()}-${monday.getMonth() + 1}-${monday.getDate()}`;
    }
    grouped.set(key, item);
  }
  return Array.from(grouped.values()).slice(-180);
}

function periodKey(timestamp: number, period: "weekly" | "monthly") {
  const date = new Date(timestamp + 8 * 60 * 60 * 1000);
  if (period === "monthly") return `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}`;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = monday.getUTCDay() || 7;
  monday.setUTCDate(monday.getUTCDate() - day + 1);
  return `${monday.getUTCFullYear()}-${monday.getUTCMonth() + 1}-${monday.getUTCDate()}`;
}

function aggregateOhlc(history: OhlcHistoryItem[], period: Exclude<ChartPeriod, "intraday">) {
  if (period === "daily") return history.slice(-180);
  const grouped = new Map<string, OhlcHistoryItem>();
  for (const item of history) {
    const key = periodKey(item.timestamp, period);
    const current = grouped.get(key);
    grouped.set(key, current ? {
      timestamp: item.timestamp,
      open: current.open,
      high: Math.max(current.high, item.high),
      low: Math.min(current.low, item.low),
      close: item.close,
      volume: (current.volume ?? 0) + (item.volume ?? 0)
    } : { ...item });
  }
  return Array.from(grouped.values()).slice(-180);
}

function historyToProfessionalData(history: HistoryItem[]) {
  return history.flatMap((item) => {
    const normalized = item.date.includes(" ")
      ? `${item.date.replace(" ", "T")}+08:00`
      : `${item.date}T00:00:00+08:00`;
    const timestamp = new Date(normalized).getTime();
    return Number.isFinite(timestamp)
      ? [{ timestamp, open: item.value, high: item.value, low: item.value, close: item.value }]
      : [];
  });
}

function fmtNum(value: number | null, digits = 2) {
  if (value === null || Number.isNaN(value)) return "--";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function Sparkline({
  data,
  strokeClassName
}: {
  data: HistoryItem[] | null;
  strokeClassName: string;
}) {
  const points = useMemo(() => {
    const usable = (data || []).filter((item) => Number.isFinite(item.value));
    if (usable.length < 2) return "";
    const width = 520;
    const height = 160;
    const min = Math.min(...usable.map((item) => item.value));
    const max = Math.max(...usable.map((item) => item.value));
    const range = max - min || 1;
    return usable
      .map((item, idx) => {
        const x = (idx / (usable.length - 1)) * width;
        const y = height - ((item.value - min) / range) * height;
        return `${x},${y}`;
      })
      .join(" ");
  }, [data]);

  return (
    <div className="h-28 w-full">
      <svg viewBox="0 0 520 160" className="h-full w-full">
        <polyline
          points={points}
          fill="none"
          className={strokeClassName}
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function DashboardIndicatorCard({
  card,
  onOpenChart
}: {
  card: DashboardCard;
  onOpenChart: (card: DashboardCard) => void;
}) {
  const accentClass = sparklineColorMap[card.statusColor || "neutral"] || sparklineColorMap.neutral;
  const numberColorClass = valueColorMap[card.statusColor || "neutral"] || valueColorMap.neutral;
  const changeColorClass =
    card.secondaryValue === null
      ? "text-slate-500"
      : card.secondaryValue > 0
        ? "text-emerald-500"
        : card.secondaryValue < 0
          ? "text-rose-500"
          : "text-slate-500";

  return (
    <article className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-2xl font-bold text-slate-900">{card.name}</h3>
          <p className="mt-1 break-all text-lg font-semibold tracking-wide text-slate-500">{card.ticker}</p>
        </div>
        <div className="flex shrink-0 items-start gap-2">
          {card.statusText ? (
            <span
              className={`inline-flex h-15 w-20 shrink-0 items-center justify-center rounded-lg border px-2 text-center text-sm font-semibold leading-5 break-words ${
                statusColorMap[card.statusColor || "neutral"] || statusColorMap.neutral
              }`}
            >
              {card.statusText}
            </span>
          ) : null}
          <ChevronRight className="mt-1 h-5 w-5 text-slate-400" />
        </div>
      </div>

      <div className="mb-3 flex items-end gap-3">
        <span className={`text-5xl font-bold ${numberColorClass}`}>{formatValue(card.value, card.unit)}</span>
        <span className="pb-2 text-2xl font-semibold text-slate-500">{card.unit || ""}</span>
      </div>

      <div className="mb-4 text-lg font-semibold text-slate-500">
        日内变动: <span className={changeColorClass}>{formatChange(card.secondaryValue)}</span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-6 text-sm text-slate-500">
        <span className="inline-flex items-center gap-2">
          <CalendarDays className="h-4 w-4" />
          数据: {formatDate(card.dataDate)}
        </span>
        <span className="inline-flex items-center gap-2">
          <Clock3 className="h-4 w-4" />
          {card.updateFrequency || "--"}
        </span>
      </div>

      <Sparkline data={(card.history || []).slice(-180)} strokeClassName={accentClass} />

      <div className="mt-2 border-t border-slate-200 pt-4 text-lg text-slate-600">
        {card.shortDescription || "暂无说明"}
      </div>

      <button
        type="button"
        onClick={() => onOpenChart(card)}
        className="mt-auto pt-4 text-center text-base font-semibold text-indigo-500 transition hover:text-indigo-600"
      >
        点击查看详细图表 →
      </button>
    </article>
  );
}

function IndicatorDetailDialog({
  card,
  open,
  onOpenChange,
  sourceFooter,
  sourceLinks
}: {
  card: DashboardCard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceFooter: string;
  sourceLinks: Record<string, string>;
}) {
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>("daily");

  useEffect(() => {
    setChartPeriod("daily");
  }, [card?.id, open]);

  if (!card) return null;

  const stats = cardStats((card.history || []).slice(-180));
  const historyPoints = card.history || [];
  const intradayPoints = card.intradayHistory ?? (card.id === "southbound_flow" ? historyPoints : []);
  const isCandlestick = chartPeriod !== "intraday" && Boolean(card.ohlcHistory?.length);
  const chartData = chartPeriod === "intraday"
    ? historyToProfessionalData(intradayPoints)
    : isCandlestick
      ? aggregateOhlc(card.ohlcHistory ?? [], chartPeriod)
      : historyToProfessionalData(aggregateHistory(historyPoints, chartPeriod));
  const professionalPeriod = chartPeriod === "intraday"
    ? { type: "minute" as const, span: 1 }
    : chartPeriod === "weekly"
      ? { type: "week" as const, span: 1 }
      : chartPeriod === "monthly"
        ? { type: "month" as const, span: 1 }
        : { type: "day" as const, span: 1 };
  const sourceLink = card ? sourceLinks[card.id] ?? null : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[95vw] max-w-5xl flex-col overflow-hidden p-0">
        <DialogHeader className="mb-0 shrink-0 border-b border-slate-200 px-6 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-indigo-100 p-3 text-indigo-600">
                <TrendingUp className="h-6 w-6" />
              </div>
              <div>
                <DialogTitle>{card.name}</DialogTitle>
                <DialogDescription className="mt-1 font-mono">{card.ticker}</DialogDescription>
              </div>
            </div>
            <DialogClose asChild>
              <button
                type="button"
                className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </DialogClose>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-6 px-6 py-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="mb-1 text-sm text-slate-500">当前值</p>
                <p className="text-3xl font-bold text-slate-900">
                  {formatValue(card.value, card.unit)}
                  <span className="ml-1 text-lg text-slate-500">{card.unit}</span>
                </p>
                <div className="mt-2 inline-block rounded border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600">
                  {card.statusText}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm text-slate-500">
                  <CalendarDays className="h-4 w-4 text-indigo-500" />
                  数据日期
                </div>
                <p className="text-lg font-semibold text-slate-900">{formatDateWithWeekday(card.dataDate)}</p>
                <p className="mt-1 text-xs text-slate-500">更新频率: {card.updateFrequency}</p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm text-slate-500">
                  <Clock3 className="h-4 w-4 text-amber-500" />
                  日内变化
                </div>
                <p className="text-2xl font-semibold text-slate-900">{formatChange(card.secondaryValue)}</p>
                <p className="mt-1 text-xs text-slate-500">日 K 数据点: {Math.min(historyPoints.length, 180)} 个</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
                <p className="text-xs text-slate-500">最小值</p>
                <p className="text-lg font-semibold text-blue-600">{fmtNum(stats.min)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
                <p className="text-xs text-slate-500">最大值</p>
                <p className="text-lg font-semibold text-rose-600">{fmtNum(stats.max)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
                <p className="text-xs text-slate-500">平均值</p>
                <p className="text-lg font-semibold text-slate-700">{fmtNum(stats.avg)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
                <p className="text-xs text-slate-500">区间变化</p>
                <p className="text-lg font-semibold text-indigo-600">
                  {stats.rangePct === null ? "--" : `${stats.rangePct > 0 ? "+" : ""}${stats.rangePct.toFixed(2)}%`}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-slate-800">历史数据图表</h3>
                <span className="text-xs text-slate-500">当前 {chartData.length} 个数据点</span>
              </div>
              <ProfessionalMarketChart
                data={chartData}
                mode={isCandlestick ? "candlestick" : "line"}
                ticker={card.ticker}
                period={professionalPeriod}
                emptyText={chartPeriod === "intraday" ? "该指标的数据源暂不提供当日分时数据" : "暂无可用历史数据"}
              />
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1" role="group" aria-label="历史图表周期">
                {chartPeriodOptions.map((option) => {
                  const active = chartPeriod === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setChartPeriod(option.key)}
                      className={`min-w-20 rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                        active
                          ? "border-indigo-500 bg-indigo-500 text-white shadow-sm"
                          : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h4 className="mb-2 text-sm font-semibold text-slate-700">指标说明</h4>
                <p className="text-sm leading-relaxed text-slate-600">
                  {card.detailDescription || card.shortDescription || "暂无说明"}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h4 className="mb-2 text-sm font-semibold text-slate-700">计算与来源</h4>
                <p className="text-sm text-slate-600">计算公式：{card.formula}</p>
                <p className="mt-1 text-sm text-slate-600">数据范围：{card.dataRange}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3">
          <p className="text-xs text-slate-500">数据来源: {sourceFooter} · 点击空白处关闭</p>
          {sourceLink ? (
            <a
              href={sourceLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              查看原始数据
            </a>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MarketWeatherDashboard({ config }: { config: MarketWeatherDashboardConfig }) {
  const [data, setData] = useState<WeatherResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<DashboardCard | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(config.apiPath, {
          method: "GET"
        });
        const json = (await response.json()) as WeatherResponse | { error?: string };
        if (!response.ok) {
          throw new Error(`暂时无法加载${config.title}数据`);
        }
        if (active) {
          setData(json as WeatherResponse);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "加载失败");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [config.apiPath, config.title]);

  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-8">
          <div className="mb-8 flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">{config.title}</h1>
              <p className="mt-1 text-sm text-slate-500">数据源：{config.sourceLabel}</p>
              <p className="mt-1 text-sm text-slate-500">
                最后更新：{formatDateTime(data?.lastUpdatedAt ?? data?.generatedAt)}（每
                {data?.cache?.refreshIntervalMinutes ?? 30}
                分钟）
              </p>
            </div>
            <Link
              href="/apps/invest-weather-station"
              className={buttonVariants({ variant: "outline" })}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              返回气象站首页
            </Link>
          </div>

          {loading ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-500">{config.loadingText ?? "正在加载指标数据..."}</div>
          ) : error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-700">{error}</div>
          ) : (
            <div className="space-y-9">
              {(data?.sections || []).map((section) => (
                <section key={section.key} className="space-y-5">
                  <h2 className="text-xl font-semibold text-slate-800">• {section.title}</h2>
                  <div
                    className={`grid gap-6 ${
                      (config.featuredSectionKeys ?? ["market"]).includes(section.key) ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1 md:grid-cols-2 xl:grid-cols-4"
                    }`}
                  >
                    {section.cards.map((card) => (
                      <DashboardIndicatorCard
                        key={card.id}
                        card={card}
                        onOpenChart={(item) => {
                          setSelectedCard(item);
                        }}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
        <IndicatorDetailDialog
          card={selectedCard}
          open={Boolean(selectedCard)}
          onOpenChange={(open) => {
            if (!open) setSelectedCard(null);
          }}
          sourceFooter={config.sourceFooter}
          sourceLinks={config.sourceLinks}
        />
      </AppShell>
    </AuthGuard>
  );
}
