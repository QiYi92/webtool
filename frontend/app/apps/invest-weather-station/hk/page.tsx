"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CalendarDays, ChevronRight, Clock3, ExternalLink, TrendingUp, X } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { AuthGuard } from "@/components/AuthGuard";
import { buttonVariants } from "@/components/ui/button";
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
};

type HkSection = {
  key: string;
  title: string;
  cards: DashboardCard[];
};

type HkWeatherResponse = {
  generatedAt: string;
  lastUpdatedAt?: string;
  cache?: {
    refreshIntervalMinutes?: number;
  };
  sections: HkSection[];
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
  if (unit.toLowerCase().includes("比值")) return value.toFixed(3);
  if (unit.includes("%") || unit === "HKD/USD") return value.toFixed(2);
  return value.toFixed(2);
}

function formatChange(change: number | null, card: DashboardCard) {
  if (change === null || Number.isNaN(change)) return card.id === "southbound_flow" ? "--" : "%";
  if (card.id === "southbound_flow") return "--";
  if (card.id === "hk_style_rotation") {
    return `${change > 0 ? "+" : ""}${change.toFixed(2)}% / 20日`;
  }
  const sign = change > 0 ? "+" : "";
  return `${sign}${change.toFixed(2)}%`;
}

function formatDate(date: string | null) {
  if (!date) return "--";
  return date;
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

function formatDateWithWeekday(date: string | null) {
  if (!date) return "--";
  const normalized = date.includes(" ") ? date.replace(" ", "T") : `${date}T00:00:00`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long"
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

function fmtNum(value: number | null, digits = 2) {
  if (value === null || Number.isNaN(value)) return "--";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function sourceLinkForCard(card: DashboardCard) {
  const ticker = card.ticker || "";
  if (ticker.startsWith("FRED: ")) {
    const seriesId = ticker.replace("FRED: ", "").trim();
    return `https://fred.stlouisfed.org/series/${seriesId}`;
  }
  if (card.id === "hsi_index") return "https://quote.eastmoney.com/q/100.hsi.html";
  if (card.id === "hstech_index") return "https://quote.eastmoney.com/q/124.hstech.html";
  if (card.id === "hk_dividend_lowvol") return "https://quote.eastmoney.com/q/124.hshylv.html";
  if (card.id === "hk_style_rotation") return "https://quote.eastmoney.com/q/124.hshylv.html";
  if (card.id === "southbound_flow") return "https://data.eastmoney.com/hsgt/hsgtDetail/scgk.html";
  return null;
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

function DetailedChart({
  history,
  strokeClassName,
  seriesName,
  unit
}: {
  history: HistoryItem[];
  strokeClassName: string;
  seriesName: string;
  unit: string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const WIDTH = 920;
  const HEIGHT = 300;
  const MARGIN = { top: 10, right: 10, bottom: 28, left: 56 };
  const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
  const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;

  const computed = useMemo(() => {
    if (history.length < 2) {
      return {
        points: "",
        min: 0,
        max: 0,
        coords: [] as Array<{ x: number; y: number }>,
        yTicks: [] as number[],
        xTicks: [] as Array<{ index: number; x: number; label: string }>
      };
    }
    const min = Math.min(...history.map((item) => item.value));
    const max = Math.max(...history.map((item) => item.value));
    const range = max - min || 1;
    const coords = history
      .map((item, idx) => {
        const x = MARGIN.left + (idx / (history.length - 1)) * PLOT_WIDTH;
        const y = MARGIN.top + PLOT_HEIGHT - ((item.value - min) / range) * PLOT_HEIGHT;
        return { x, y };
      });
    const points = coords.map((p) => `${p.x},${p.y}`).join(" ");
    const yTickCount = 5;
    const yTicks = Array.from({ length: yTickCount }, (_, i) => max - (i * (max - min)) / (yTickCount - 1));
    const xTickCount = Math.min(14, history.length);
    const xTicks = Array.from({ length: xTickCount }, (_, i) => {
      const index = Math.round((i * (history.length - 1)) / (xTickCount - 1));
      const date = history[index]?.date || "";
      const [year, month, day] = date.split("-");
      const label = month && day ? `${Number(month)}/${Number(day)}` : date;
      const x = MARGIN.left + (index / (history.length - 1)) * PLOT_WIDTH;
      return { index, x, label };
    });
    return { points, min, max, coords, yTicks, xTicks };
  }, [history]);

  const hoverPoint = hoverIndex !== null ? computed.coords[hoverIndex] : null;
  const hoverData = hoverIndex !== null ? history[hoverIndex] : null;

  const fmtTooltipValue = (value: number) => {
    const digits = Math.abs(value) >= 1000 ? 2 : 4;
    return value.toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  };

  const onMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || history.length < 2) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const ratio = Math.min(1, Math.max(0, (x - MARGIN.left) / PLOT_WIDTH));
    const idx = Math.round(ratio * (history.length - 1));
    setHoverIndex(idx);
  };

  if (history.length < 2) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
        暂无足够历史数据可绘制图表
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-80 w-full rounded-xl border border-slate-200 bg-slate-50 p-3"
      onMouseMove={onMouseMove}
      onMouseLeave={() => setHoverIndex(null)}
    >
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-full w-full">
        {computed.yTicks.map((tick, idx) => {
          const y = MARGIN.top + (idx * PLOT_HEIGHT) / (computed.yTicks.length - 1);
          return (
            <g key={`y-${tick}`}>
              <line x1={MARGIN.left} y1={y} x2={WIDTH - MARGIN.right} y2={y} className="stroke-slate-200" />
              <text x={MARGIN.left - 6} y={y + 4} textAnchor="end" className="fill-slate-400 text-[11px]">
                {Math.round(tick)}
              </text>
            </g>
          );
        })}
        {computed.xTicks.map((tick) => (
          <g key={`x-${tick.index}-${tick.label}`}>
            <line
              x1={tick.x}
              y1={MARGIN.top}
              x2={tick.x}
              y2={HEIGHT - MARGIN.bottom}
              className="stroke-slate-200"
              strokeDasharray="3 4"
            />
            <text
              x={tick.x}
              y={HEIGHT - 6}
              textAnchor="middle"
              className="fill-slate-400 text-[11px]"
            >
              {tick.label}
            </text>
          </g>
        ))}
        <line
          x1={MARGIN.left}
          y1={HEIGHT - MARGIN.bottom}
          x2={WIDTH - MARGIN.right}
          y2={HEIGHT - MARGIN.bottom}
          className="stroke-slate-300"
        />
        <line x1={MARGIN.left} y1={MARGIN.top} x2={MARGIN.left} y2={HEIGHT - MARGIN.bottom} className="stroke-slate-300" />
        <polyline
          points={computed.points}
          fill="none"
          className={strokeClassName}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {hoverPoint ? (
          <>
            <line
              x1={hoverPoint.x}
              y1={MARGIN.top}
              x2={hoverPoint.x}
              y2={HEIGHT - MARGIN.bottom}
              className="stroke-slate-400"
              strokeWidth="1.5"
            />
            <circle cx={hoverPoint.x} cy={hoverPoint.y} r="5" className="fill-white stroke-slate-600" strokeWidth="2" />
          </>
        ) : null}
      </svg>
      {hoverPoint && hoverData ? (
        <div
          className="pointer-events-none absolute z-10 w-64 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg"
          style={{
            left: `${Math.min(70, Math.max(2, (hoverPoint.x / WIDTH) * 100 + 2))}%`,
            top: "16px"
          }}
        >
          <p className="text-xs uppercase tracking-wide text-slate-400">{seriesName}</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">
            {fmtTooltipValue(hoverData.value)} {unit}
          </p>
          <p className="mt-1 text-sm text-slate-500">{hoverData.date}</p>
        </div>
      ) : null}
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
  const badgeClass = statusColorMap[card.statusColor || "neutral"] ?? statusColorMap.neutral;
  const valueClass = valueColorMap[card.statusColor || "neutral"] ?? valueColorMap.neutral;
  const sparklineClass = sparklineColorMap[card.statusColor || "neutral"] ?? sparklineColorMap.neutral;

  return (
    <button
      type="button"
      className="group rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
      onClick={() => onOpenChart(card)}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{card.ticker}</p>
          <h3 className="mt-1 text-lg font-semibold text-slate-900">{card.name}</h3>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${badgeClass}`}>{card.statusText}</span>
      </div>

      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <div className={`text-3xl font-bold ${valueClass}`}>
            {formatValue(card.value, card.unit)}
            <span className="ml-1 text-sm font-medium text-slate-400">{card.unit}</span>
          </div>
          <div className={`mt-2 text-sm font-semibold ${card.secondaryValue === null ? "text-slate-400" : card.secondaryValue >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
            {formatChange(card.secondaryValue, card)}
          </div>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div>频率：{card.updateFrequency || "--"}</div>
          <div className="mt-1">日期：{formatDate(card.dataDate)}</div>
        </div>
      </div>

      <Sparkline data={card.history} strokeClassName={sparklineClass} />

      <div className="mt-4 flex items-center justify-between gap-3 text-sm">
        <p className="line-clamp-2 text-slate-500">{card.shortDescription}</p>
        <div className="shrink-0 whitespace-nowrap flex items-center gap-1 font-medium text-slate-700 transition group-hover:text-indigo-600">
          查看详情
          <ChevronRight className="h-4 w-4" />
        </div>
      </div>
    </button>
  );
}

function IndicatorDetailDialog({
  card,
  open,
  onOpenChange
}: {
  card: DashboardCard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const historyPoints = card?.history ?? [];
  const stats = card ? cardStats(historyPoints) : cardStats([]);
  const accentClass = sparklineColorMap[card?.statusColor || "neutral"] ?? sparklineColorMap.neutral;
  const sourceLink = card ? sourceLinkForCard(card) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white p-0">
        <DialogHeader className="border-b border-slate-200 bg-slate-50 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle className="text-2xl font-semibold text-slate-900">{card?.name || "指标详情"}</DialogTitle>
              <DialogDescription className="mt-2 text-sm text-slate-500">
                点击卡片进入的历史数据详情视图，支持图表 hover 查看具体点位。
              </DialogDescription>
            </div>
            <DialogClose className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-100">
              <X className="h-4 w-4" />
            </DialogClose>
          </div>
        </DialogHeader>

        <div className="max-h-[calc(90vh-150px)] overflow-y-auto px-6 py-5">
          <div className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-[1.5fr,1fr]">
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center gap-2 text-sm text-slate-500">
                  <TrendingUp className="h-4 w-4 text-indigo-500" />
                  核心数值
                </div>
                <div className="text-4xl font-bold text-slate-900">
                  {formatValue(card?.value ?? null, card?.unit ?? "")}
                  <span className="ml-2 text-base font-medium text-slate-400">{card?.unit}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-sm">
                  <span className={`rounded-full border px-3 py-1 ${statusColorMap[card?.statusColor || "neutral"]}`}>
                    {card?.statusText}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600">
                    {card?.ticker}
                  </span>
                </div>
              </div>

              <div className="grid gap-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm text-slate-500">
                    <CalendarDays className="h-4 w-4 text-blue-500" />
                    数据日期
                  </div>
                  <p className="text-lg font-semibold text-slate-900">{formatDateWithWeekday(card?.dataDate ?? null)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm text-slate-500">
                    <Clock3 className="h-4 w-4 text-amber-500" />
                    日内变化
                  </div>
                  <p className="text-2xl font-semibold text-slate-900">{card ? formatChange(card.secondaryValue, card) : "--"}</p>
                  <p className="mt-1 text-xs text-slate-500">数据点: {historyPoints.length} 个</p>
                </div>
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
                <span className="text-xs text-slate-500">过去 {historyPoints.length} 个数据点</span>
              </div>
              <DetailedChart
                history={historyPoints}
                strokeClassName={accentClass}
                seriesName={card?.name || "指标"}
                unit={card?.unit || ""}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h4 className="mb-2 text-sm font-semibold text-slate-700">指标说明</h4>
                <p className="text-sm leading-relaxed text-slate-600">
                  {card?.detailDescription || card?.shortDescription || "暂无说明"}
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h4 className="mb-2 text-sm font-semibold text-slate-700">计算与来源</h4>
                <p className="text-sm text-slate-600">计算公式：{card?.formula || "--"}</p>
                <p className="mt-1 text-sm text-slate-600">数据范围：{card?.dataRange || "--"}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3">
          <p className="text-xs text-slate-500">数据来源: FRED + 东方财富公开行情接口 · 点击空白处关闭</p>
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

export default function HongKongWeatherStationPage() {
  const [data, setData] = useState<HkWeatherResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<DashboardCard | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/invest-weather/hk", {
          method: "GET"
        });
        const json = (await response.json()) as HkWeatherResponse | { error?: string };
        if (!response.ok) {
          throw new Error("暂时无法加载港股气象站数据");
        }
        if (active) {
          setData(json as HkWeatherResponse);
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
  }, []);

  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-8">
          <div className="mb-8 flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">港股恒生气象站</h1>
              <p className="mt-1 text-sm text-slate-500">数据源：FRED + 东方财富公开行情接口</p>
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
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-500">正在加载港股指标数据...</div>
          ) : error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-700">{error}</div>
          ) : (
            <div className="space-y-9">
              {(data?.sections || []).map((section) => (
                <section key={section.key} className="space-y-5">
                  <h2 className="text-xl font-semibold text-slate-800">• {section.title}</h2>
                  <div
                    className={`grid gap-6 ${
                      section.key === "market" || section.key === "style"
                        ? "grid-cols-1 xl:grid-cols-2"
                        : "grid-cols-1 md:grid-cols-2 xl:grid-cols-4"
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
        />
      </AppShell>
    </AuthGuard>
  );
}
