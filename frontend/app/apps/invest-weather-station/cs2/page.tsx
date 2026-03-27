"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CalendarDays, ChevronRight, Clock3, TrendingUp, X } from "lucide-react";

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

type RankingItem = {
  name: string;
  value: number | null;
  changeRate: number | null;
  changeValue: number | null;
  level: number | null;
  type: string | null;
  typeVal?: string | null;
  trendList?: HistoryItem[] | null;
};

type BoardSection = {
  key: string;
  title: string;
  subtitle: string;
  defaultList: RankingItem[];
  topList: RankingItem[];
  bottomList: RankingItem[];
};

type Cs2WeatherResponse = {
  generatedAt: string;
  lastUpdatedAt?: string;
  cache?: {
    refreshIntervalMinutes?: number;
  };
  sections: Array<{
    key: string;
    title: string;
    cards: DashboardCard[];
  }>;
  boards: BoardSection[];
};

type BlockDetailResponse = {
  name: string;
  type: string;
  typeVal: string;
  level: number;
  currentIndex: number | null;
  yesterdayIndex: number | null;
  highIndex: number | null;
  lowIndex: number | null;
  riseFallDiff: number | null;
  riseFallRate: number | null;
  updateTime: string | null;
  priceHistory: HistoryItem[];
  sellCountHistory: HistoryItem[];
  components: Array<{
    name: string;
    imageUrl: string;
    marketHashName: string;
    price: number | null;
    priceDiff: number | null;
    priceRate: number | null;
  }>;
  componentsUp?: Array<{
    name: string;
    imageUrl: string;
    marketHashName: string;
    price: number | null;
    priceDiff: number | null;
    priceRate: number | null;
  }>;
  componentsDown?: Array<{
    name: string;
    imageUrl: string;
    marketHashName: string;
    price: number | null;
    priceDiff: number | null;
    priceRate: number | null;
  }>;
  trendSourceAvailable: boolean;
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

function formatChineseNumber(value: number | null, unit: string) {
  if (value === null || Number.isNaN(value)) return "--";
  const abs = Math.abs(value);
  if (unit === "点") return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (unit === "元" && abs >= 100000000) return `${(value / 100000000).toFixed(3)}亿`;
  if ((unit === "元" || unit === "件" || unit === "人") && abs >= 10000) {
    return `${(value / 10000).toFixed(3)}万`;
  }
  if (abs >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return value.toFixed(2);
}

function formatChange(change: number | null) {
  if (change === null || Number.isNaN(change)) return "--";
  const sign = change > 0 ? "+" : "";
  return `${sign}${change.toFixed(2)}%`;
}

function formatDate(date: string | null) {
  if (!date) return "--";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
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

function fmtNum(value: number | null, digits = 2) {
  if (value === null || Number.isNaN(value)) return "--";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
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

  if (!points) {
    return (
      <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-400">
        暂无历史曲线
      </div>
    );
  }

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
  strokeClassName
}: {
  history: HistoryItem[];
  strokeClassName: string;
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
        coords: [] as Array<{ x: number; y: number }>,
        yTicks: [] as number[],
        xTicks: [] as Array<{ index: number; x: number; label: string }>
      };
    }
    const min = Math.min(...history.map((item) => item.value));
    const max = Math.max(...history.map((item) => item.value));
    const range = max - min || 1;
    const coords = history.map((item, idx) => {
      const x = MARGIN.left + (idx / (history.length - 1)) * PLOT_WIDTH;
      const y = MARGIN.top + PLOT_HEIGHT - ((item.value - min) / range) * PLOT_HEIGHT;
      return { x, y };
    });
    const points = coords.map((p) => `${p.x},${p.y}`).join(" ");
    const yTicks = Array.from({ length: 5 }, (_, idx) => max - (idx * (max - min)) / 4);
    const xTicks = Array.from({ length: Math.min(10, history.length) }, (_, idx) => {
      const index = Math.round((idx * (history.length - 1)) / (Math.min(10, history.length) - 1 || 1));
      const date = history[index]?.date || "";
      const parsed = new Date(date);
      const label = Number.isNaN(parsed.getTime())
        ? date
        : new Intl.DateTimeFormat("zh-CN", {
            timeZone: "Asia/Shanghai",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit"
          }).format(parsed);
      const x = MARGIN.left + (index / (history.length - 1)) * PLOT_WIDTH;
      return { index, x, label };
    });
    return { points, coords, yTicks, xTicks };
  }, [history]);

  const hoverPoint = hoverIndex !== null ? computed.coords[hoverIndex] : null;
  const hoverData = hoverIndex !== null ? history[hoverIndex] : null;

  const onMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || history.length < 2) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const ratio = Math.min(1, Math.max(0, (x - MARGIN.left) / PLOT_WIDTH));
    setHoverIndex(Math.round(ratio * (history.length - 1)));
  };

  if (history.length < 2) {
    return (
      <div className="flex h-80 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-slate-400">
        当前指标暂无可持续历史序列
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
            <g key={`${tick}-${idx}`}>
              <line x1={MARGIN.left} y1={y} x2={WIDTH - MARGIN.right} y2={y} className="stroke-slate-200" />
              <text x={MARGIN.left - 6} y={y + 4} textAnchor="end" className="fill-slate-400 text-[11px]">
                {Math.round(tick)}
              </text>
            </g>
          );
        })}
        {computed.xTicks.map((tick) => (
          <g key={`${tick.index}-${tick.label}`}>
            <line
              x1={tick.x}
              y1={MARGIN.top}
              x2={tick.x}
              y2={HEIGHT - MARGIN.bottom}
              className="stroke-slate-200"
              strokeDasharray="3 4"
            />
            <text x={tick.x} y={HEIGHT - 6} textAnchor="middle" className="fill-slate-400 text-[11px]">
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
        <div className="pointer-events-none absolute right-4 top-4 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-sm shadow-lg">
          <p className="font-semibold text-slate-900">{formatDate(hoverData.date)}</p>
          <p className="text-slate-600">{fmtNum(hoverData.value)}</p>
        </div>
      ) : null}
    </div>
  );
}

function BlockTrendChart({
  priceHistory
}: {
  priceHistory: HistoryItem[];
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const WIDTH = 920;
  const HEIGHT = 360;
  const MARGIN = { top: 16, right: 16, bottom: 34, left: 72 };
  const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
  const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;

  const priceValues = priceHistory.map((item) => item.value);
  const priceMin = priceValues.length ? Math.min(...priceValues) : 0;
  const priceMax = priceValues.length ? Math.max(...priceValues) : 1;
  const priceRange = priceMax - priceMin || 1;

  const toPoints = (history: HistoryItem[], min: number, range: number) =>
    history
      .map((item, index) => {
        const x = MARGIN.left + (index / Math.max(history.length - 1, 1)) * PLOT_WIDTH;
        const y = MARGIN.top + PLOT_HEIGHT - ((item.value - min) / range) * PLOT_HEIGHT;
        return `${x},${y}`;
      })
      .join(" ");

  const xTicks = Array.from({ length: Math.min(6, priceHistory.length) }, (_, idx) => {
    const index = Math.round((idx * Math.max(priceHistory.length - 1, 0)) / Math.max(Math.min(6, priceHistory.length) - 1, 1));
    const point = priceHistory[index];
    return {
      x: MARGIN.left + (index / Math.max(priceHistory.length - 1, 1)) * PLOT_WIDTH,
      label: point ? formatDate(point.date) : ""
    };
  });

  const leftTicks = Array.from({ length: 5 }, (_, idx) => priceMax - (idx * (priceMax - priceMin)) / 4);
  const hoverPoint =
    hoverIndex !== null && priceHistory[hoverIndex]
      ? {
          x: MARGIN.left + (hoverIndex / Math.max(priceHistory.length - 1, 1)) * PLOT_WIDTH,
          y: MARGIN.top + PLOT_HEIGHT - ((priceHistory[hoverIndex].value - priceMin) / priceRange) * PLOT_HEIGHT
        }
      : null;
  const hoverData = hoverIndex !== null ? priceHistory[hoverIndex] ?? null : null;

  const onMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || priceHistory.length < 2) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const ratio = Math.min(1, Math.max(0, (x - MARGIN.left) / PLOT_WIDTH));
    setHoverIndex(Math.round(ratio * (priceHistory.length - 1)));
  };

  if (priceHistory.length < 2) {
    return (
      <div className="flex h-80 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-slate-400">
        暂无板块走势数据
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
        <span className="inline-flex items-center gap-2 text-orange-500">
          <span className="h-2.5 w-2.5 rounded-full bg-orange-400" />
          价格
        </span>
      </div>
      <div
        ref={containerRef}
        className="relative h-80 w-full overflow-hidden"
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-full w-full">
          {leftTicks.map((tick, idx) => {
            const y = MARGIN.top + (idx * PLOT_HEIGHT) / Math.max(leftTicks.length - 1, 1);
            return (
              <g key={`left-${tick}-${idx}`}>
                <line x1={MARGIN.left} y1={y} x2={WIDTH - MARGIN.right} y2={y} className="stroke-slate-200" />
                <text x={MARGIN.left - 8} y={y + 4} textAnchor="end" className="fill-slate-400 text-[11px]">
                  {fmtNum(tick)}
                </text>
              </g>
            );
          })}
          {xTicks.map((tick, idx) => (
            <g key={`x-${tick.label}-${idx}`}>
              <line x1={tick.x} y1={MARGIN.top} x2={tick.x} y2={HEIGHT - MARGIN.bottom} className="stroke-slate-200" strokeDasharray="3 4" />
              <text x={tick.x} y={HEIGHT - 8} textAnchor="middle" className="fill-slate-400 text-[11px]">
                {tick.label}
              </text>
            </g>
          ))}
          <line x1={MARGIN.left} y1={MARGIN.top} x2={MARGIN.left} y2={HEIGHT - MARGIN.bottom} className="stroke-slate-300" />
          <line x1={MARGIN.left} y1={HEIGHT - MARGIN.bottom} x2={WIDTH - MARGIN.right} y2={HEIGHT - MARGIN.bottom} className="stroke-slate-300" />
          <polyline
            points={toPoints(priceHistory, priceMin, priceRange)}
            fill="none"
            className="stroke-orange-400"
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
              <circle cx={hoverPoint.x} cy={hoverPoint.y} r="5" className="fill-white stroke-orange-500" strokeWidth="2.5" />
            </>
          ) : null}
        </svg>
        {hoverPoint && hoverData ? (
          <div className="pointer-events-none absolute right-4 top-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
            <p className="text-lg font-semibold text-slate-900">{formatDate(hoverData.date)}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-700">{fmtNum(hoverData.value)}</p>
          </div>
        ) : null}
      </div>
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
  const hasHistory = (card.history?.length ?? 0) >= 2;
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
              className={`inline-flex min-h-10 items-center rounded-lg border px-2 py-1 text-center text-sm font-semibold ${
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
        <span className={`text-5xl font-bold ${numberColorClass}`}>{formatChineseNumber(card.value, card.unit)}</span>
        <span className="pb-2 text-2xl font-semibold text-slate-500">{card.unit || ""}</span>
      </div>

      <div className="mb-4 text-lg font-semibold text-slate-500">
        环比: <span className={changeColorClass}>{formatChange(card.secondaryValue)}</span>
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

      {hasHistory ? <Sparkline data={card.history} strokeClassName={accentClass} /> : null}

      <div className={`${hasHistory ? "mt-2 border-t border-slate-200 pt-4" : "mt-1"} text-lg text-slate-600`}>
        {card.shortDescription || "暂无说明"}
      </div>

      <button
        type="button"
        onClick={() => onOpenChart(card)}
        className="mt-auto pt-4 text-center text-base font-semibold text-indigo-500 transition hover:text-indigo-600"
      >
        点击查看详情 →
      </button>
    </article>
  );
}

function RankingTable({
  title,
  items,
  tone,
  onSelectItem
}: {
  title: string;
  items: RankingItem[];
  tone: "neutral" | "up" | "down";
  onSelectItem?: (item: RankingItem) => void;
}) {
  const valueClass =
    tone === "up" ? "text-rose-500" : tone === "down" ? "text-emerald-500" : "text-slate-700";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <p className="mt-1 text-sm text-slate-500">前 5 项</p>
        </div>
      </div>
      <div className="space-y-3">
        {items.map((item, index) => (
          <button
            key={`${title}-${item.name}-${index}`}
            type="button"
            disabled={!onSelectItem}
            onClick={() => onSelectItem?.(item)}
            className={`flex w-full items-start justify-between gap-4 border-b border-slate-100 pb-3 text-left last:border-b-0 last:pb-0 ${
              onSelectItem ? "rounded-lg transition hover:bg-slate-50" : ""
            }`}
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-400">#{index + 1}</p>
              <p className="mt-1 text-base font-semibold text-slate-900">{item.name}</p>
              <p className="mt-1 text-sm text-slate-500">
                指数 {fmtNum(item.value)} · 变动值 {fmtNum(item.changeValue)}
              </p>
              {onSelectItem ? <p className="mt-2 text-xs font-medium text-indigo-500">点击查看板块详情</p> : null}
            </div>
            <div className={`shrink-0 text-right text-lg font-semibold ${valueClass}`}>
              {formatChange(item.changeRate)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function BoardSectionPanel({
  board,
  onSelectItem
}: {
  board: BoardSection;
  onSelectItem?: (item: RankingItem) => void;
}) {
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-800">• {board.title}</h2>
        <p className="mt-1 text-sm text-slate-500">{board.subtitle}</p>
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <RankingTable title="默认排行" items={board.defaultList} tone="neutral" onSelectItem={onSelectItem} />
        <RankingTable title="上涨排行" items={board.topList} tone="up" onSelectItem={onSelectItem} />
        <RankingTable title="下跌排行" items={board.bottomList} tone="down" onSelectItem={onSelectItem} />
      </div>
    </section>
  );
}

function BoardDetailLoadingState() {
  return (
    <div className="space-y-5 px-6 py-6">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <div className="h-7 w-44 animate-pulse rounded-lg bg-slate-200" />
            <div className="mt-3 h-4 w-28 animate-pulse rounded-md bg-slate-200" />
          </div>
          <div className="h-4 w-24 animate-pulse rounded-md bg-slate-200" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm text-slate-500">
            <span>正在加载板块详情数据</span>
            <span>请稍候...</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full w-2/5 rounded-full bg-indigo-500 animate-[loadingBar_1.4s_ease-in-out_infinite]" />
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="h-5 w-20 animate-pulse rounded-md bg-slate-200" />
            <div className="mt-4 h-6 w-32 animate-pulse rounded-md bg-slate-200" />
            <div className="mt-4 h-5 w-20 animate-pulse rounded-md bg-slate-200" />
            <div className="mt-4 h-6 w-24 animate-pulse rounded-md bg-slate-200" />
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="h-6 w-24 animate-pulse rounded-md bg-slate-200" />
        <div className="mt-4 h-80 rounded-xl bg-white">
          <div className="flex h-full items-center justify-center text-sm text-slate-400">图表加载中...</div>
        </div>
      </div>

      <style jsx>{`
        @keyframes loadingBar {
          0% {
            transform: translateX(-110%);
          }
          50% {
            transform: translateX(90%);
          }
          100% {
            transform: translateX(250%);
          }
        }
      `}</style>
    </div>
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
  if (!card) return null;

  const hasHistory = (card.history?.length ?? 0) >= 2;
  const accentClass = sparklineColorMap[card.statusColor || "neutral"] || sparklineColorMap.neutral;
  const historyPoints = card.history || [];
  const stats = cardStats(historyPoints);

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
                  {formatChineseNumber(card.value, card.unit)}
                  <span className="ml-1 text-lg text-slate-500">{card.unit}</span>
                </p>
                <div className="mt-2 inline-block rounded border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600">
                  {card.statusText}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm text-slate-500">
                  <CalendarDays className="h-4 w-4 text-indigo-500" />
                  数据时间
                </div>
                <p className="text-lg font-semibold text-slate-900">{formatDate(card.dataDate)}</p>
                <p className="mt-1 text-xs text-slate-500">更新频率: {card.updateFrequency}</p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm text-slate-500">
                  <Clock3 className="h-4 w-4 text-amber-500" />
                  环比变化
                </div>
                <p className="text-2xl font-semibold text-slate-900">{formatChange(card.secondaryValue)}</p>
                <p className="mt-1 text-xs text-slate-500">历史点数: {historyPoints.length}</p>
              </div>
            </div>

            {hasHistory ? (
              <>
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

                <DetailedChart history={historyPoints} strokeClassName={accentClass} />
              </>
            ) : null}

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

        <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-6 py-3 text-xs text-slate-500">
          数据来源: SteamDT 首页内部数据接口镜像（经服务端抓取与缓存）
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BoardDetailDialog({
  boardKey,
  item,
  detail,
  loading,
  error,
  open,
  onOpenChange
}: {
  boardKey: string | null;
  item: RankingItem | null;
  detail: BlockDetailResponse | null;
  loading: boolean;
  error: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [componentSort, setComponentSort] = useState<"desc" | "asc">("desc");

  useEffect(() => {
    setComponentSort("desc");
  }, [item?.name, open]);

  const sortedComponents = useMemo(() => {
    if (!detail) return [];
    if (componentSort === "desc") {
      return (detail.componentsUp ?? detail.components ?? []).slice(0, 10);
    }
    return (detail.componentsDown ?? []).slice(0, 10);
  }, [componentSort, detail]);

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[96vw] max-w-6xl flex-col overflow-hidden p-0">
        <DialogHeader className="mb-0 shrink-0 border-b border-slate-200 px-6 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-indigo-100 p-3 text-indigo-600">
                <TrendingUp className="h-6 w-6" />
              </div>
              <div>
                <DialogTitle>{detail?.name ?? item.name}</DialogTitle>
                <DialogDescription className="mt-1">
                  {boardKey === "hot" ? "热门板块详情" : "一级板块详情"}
                </DialogDescription>
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
          {loading ? (
            <BoardDetailLoadingState />
          ) : error ? (
            <div className="p-6 text-rose-600">{error}</div>
          ) : detail ? (
            <div className="space-y-6 px-6 py-5">
              <div className="flex flex-wrap items-baseline gap-4">
                <div className={`text-5xl font-bold ${(detail.riseFallDiff ?? 0) >= 0 ? "text-rose-500" : "text-emerald-500"}`}>
                  {fmtNum(detail.currentIndex)}
                </div>
                <div className={`text-2xl font-semibold ${(detail.riseFallDiff ?? 0) >= 0 ? "text-rose-500" : "text-emerald-500"}`}>
                  {formatChange(detail.riseFallRate)} ({detail.riseFallDiff && detail.riseFallDiff > 0 ? "+" : ""}
                  {fmtNum(detail.riseFallDiff)})
                </div>
                <div className="text-sm text-slate-500">更新时间: {formatDateTime(detail.updateTime)}</div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between text-base">
                    <span>今日：</span>
                    <span className="font-semibold text-slate-900">{fmtNum(detail.currentIndex)}</span>
                  </div>
                  <div className="mt-4 flex items-center justify-between text-base">
                    <span>昨日：</span>
                    <span className="font-semibold text-slate-500">{fmtNum(detail.yesterdayIndex)}</span>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between text-base">
                    <span>最高：</span>
                    <span className="font-semibold text-rose-500">{fmtNum(detail.highIndex)}</span>
                  </div>
                  <div className="mt-4 flex items-center justify-between text-base">
                    <span>最低：</span>
                    <span className="font-semibold text-emerald-500">{fmtNum(detail.lowIndex)}</span>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between text-base">
                    <span>涨跌值：</span>
                    <span className={`font-semibold ${(detail.riseFallDiff ?? 0) >= 0 ? "text-rose-500" : "text-emerald-500"}`}>
                      {detail.riseFallDiff && detail.riseFallDiff > 0 ? "+" : ""}
                      {fmtNum(detail.riseFallDiff)}
                    </span>
                  </div>
                  <div className="mt-4 flex items-center justify-between text-base">
                    <span>涨跌幅：</span>
                    <span className={`font-semibold ${(detail.riseFallDiff ?? 0) >= 0 ? "text-rose-500" : "text-emerald-500"}`}>
                      {formatChange(detail.riseFallRate)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-lg font-semibold text-slate-900">走势图</h4>
                </div>
                <BlockTrendChart priceHistory={detail.priceHistory} />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-lg font-semibold text-slate-900">
                    成分饰品{componentSort === "desc" ? "涨幅" : "跌幅"}排行（Top 10）
                  </h4>
                  <button
                    type="button"
                    onClick={() => setComponentSort((current) => (current === "desc" ? "asc" : "desc"))}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:border-indigo-300 hover:text-indigo-500"
                    aria-label={componentSort === "desc" ? "切换到跌幅榜" : "切换到涨幅榜"}
                    title={componentSort === "desc" ? "切换到跌幅榜" : "切换到涨幅榜"}
                  >
                    <span className="flex flex-col items-center justify-center gap-[2px]">
                      <span
                        className={`h-0 w-0 border-x-[5px] border-b-[6px] border-x-transparent ${
                          componentSort === "desc" ? "border-b-indigo-500" : "border-b-slate-300"
                        }`}
                      />
                      <span
                        className={`h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent ${
                          componentSort === "asc" ? "border-t-indigo-500" : "border-t-slate-300"
                        }`}
                      />
                    </span>
                  </button>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white">
                  {sortedComponents.length === 0 ? (
                    <div className="p-4 text-sm text-slate-500">暂无成分饰品数据</div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {sortedComponents.map((component, index) => (
                        <div key={`${component.marketHashName}-${index}`} className="flex items-center gap-4 px-4 py-3">
                          <div className="w-7 text-sm font-semibold text-slate-400">#{index + 1}</div>
                          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-slate-50">
                            {component.imageUrl ? (
                              <img src={component.imageUrl} alt={component.name} className="h-full w-full object-cover" />
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-slate-900">{component.name}</p>
                            <p className="mt-1 text-sm text-slate-500">指数 {fmtNum(component.price)}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-base font-semibold text-slate-900">{fmtNum(component.price)}</p>
                            <p className={`mt-1 text-sm font-semibold ${(component.priceRate ?? 0) >= 0 ? "text-rose-500" : "text-emerald-500"}`}>
                              {formatChange(component.priceRate)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-6 py-3 text-xs text-slate-500">
          数据来源: SteamDT 板块关系、板块走势与成分饰品接口（经服务端抓取）
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Cs2WeatherStationPage() {
  const [data, setData] = useState<Cs2WeatherResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<DashboardCard | null>(null);
  const [selectedBoardItem, setSelectedBoardItem] = useState<{ boardKey: string; item: RankingItem } | null>(null);
  const [boardDetail, setBoardDetail] = useState<BlockDetailResponse | null>(null);
  const [boardDetailLoading, setBoardDetailLoading] = useState(false);
  const [boardDetailError, setBoardDetailError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/invest-weather/cs2", {
          method: "GET"
        });
        const json = (await response.json()) as Cs2WeatherResponse | { error?: string };
        if (!response.ok) {
          throw new Error("暂时无法加载 CS2 饰品气象站数据");
        }
        if (active) {
          setData(json as Cs2WeatherResponse);
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

  useEffect(() => {
    if (!selectedBoardItem) {
      setBoardDetail(null);
      setBoardDetailError(null);
      setBoardDetailLoading(false);
      return;
    }

    let active = true;
    const load = async () => {
      setBoardDetailLoading(true);
      setBoardDetailError(null);
      try {
        const params = new URLSearchParams({
          type: selectedBoardItem.item.type ?? "",
          typeVal: selectedBoardItem.item.typeVal ?? "",
          level: String(selectedBoardItem.item.level ?? "")
        });
        const response = await fetch(`/api/invest-weather/cs2/block-detail?${params.toString()}`);
        const json = (await response.json()) as BlockDetailResponse | { error?: string };
        if (!response.ok) {
          throw new Error((json as { error?: string }).error || "暂时无法加载板块详情");
        }
        if (active) {
          setBoardDetail(json as BlockDetailResponse);
        }
      } catch (err) {
        if (active) {
          setBoardDetailError(err instanceof Error ? err.message : "加载板块详情失败");
        }
      } finally {
        if (active) {
          setBoardDetailLoading(false);
        }
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [selectedBoardItem]);

  const marketCards = data?.sections.find((section) => section.key === "market")?.cards ?? [];

  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-8">
          <div className="mb-8 flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">CS2 饰品气象站</h1>
              <p className="mt-1 text-sm text-slate-500">数据源：SteamDT 首页市场看板与板块接口</p>
              <p className="mt-1 text-sm text-slate-500">
                最后更新：{formatDateTime(data?.lastUpdatedAt ?? data?.generatedAt)}（每
                {data?.cache?.refreshIntervalMinutes ?? 2}
                分钟）
              </p>
            </div>
            <Link href="/apps/invest-weather-station" className={buttonVariants({ variant: "outline" })}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              返回气象站首页
            </Link>
          </div>

          {loading ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-500">正在加载 CS2 饰品数据...</div>
          ) : error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-700">{error}</div>
          ) : (
            <div className="space-y-9">
              <section className="space-y-5">
                <h2 className="text-xl font-semibold text-slate-800">• 市场总览</h2>
                <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                  {marketCards.map((card) => (
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

              {data?.boards.map((board) => (
                <BoardSectionPanel
                  key={board.key}
                  board={board}
                  onSelectItem={
                    board.key === "hot" || board.key === "itemTypeLevel1"
                      ? (item) => {
                          setSelectedBoardItem({ boardKey: board.key, item });
                        }
                      : undefined
                  }
                />
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
        <BoardDetailDialog
          boardKey={selectedBoardItem?.boardKey ?? null}
          item={selectedBoardItem?.item ?? null}
          detail={boardDetail}
          loading={boardDetailLoading}
          error={boardDetailError}
          open={Boolean(selectedBoardItem)}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedBoardItem(null);
            }
          }}
        />
      </AppShell>
    </AuthGuard>
  );
}
