"use client";

import { useEffect, useRef, useState } from "react";
import type { Chart, KLineData, Period } from "klinecharts";

export type ProfessionalChartPoint = KLineData;

type Props = {
  data: ProfessionalChartPoint[];
  mode: "candlestick" | "line";
  ticker: string;
  period: Period;
  emptyText?: string;
};

export function ProfessionalMarketChart({ data, mode, ticker, period, emptyText = "暂无可用图表数据" }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) {
      setReady(false);
      return;
    }

    let cancelled = false;
    let observer: ResizeObserver | null = null;
    let chartInstance: Chart | null = null;

    void import("klinecharts").then(({ dispose, init }) => {
      if (cancelled || !containerRef.current) return;
      dispose(containerRef.current);
      const chart = init(containerRef.current, {
        locale: "zh-CN",
        timezone: "Asia/Shanghai",
        styles: {
          grid: {
            horizontal: { show: true, color: "#e2e8f0", size: 1, style: "solid", dashedValue: [2, 2] },
            vertical: { show: true, color: "#e2e8f0", size: 1, style: "dashed", dashedValue: [3, 4] }
          },
          candle: {
            type: mode === "candlestick" ? "candle_solid" : "area",
            bar: {
              compareRule: "current_open",
              upColor: "#10b981",
              downColor: "#f43f5e",
              noChangeColor: "#94a3b8",
              upBorderColor: "#10b981",
              downBorderColor: "#f43f5e",
              noChangeBorderColor: "#94a3b8",
              upWickColor: "#10b981",
              downWickColor: "#f43f5e",
              noChangeWickColor: "#94a3b8"
            },
            area: {
              lineSize: 2,
              lineColor: "#6366f1",
              value: "close",
              smooth: false,
              backgroundColor: [
                { offset: 0, color: "rgba(99, 102, 241, 0.24)" },
                { offset: 1, color: "rgba(99, 102, 241, 0.02)" }
              ]
            },
            ...(mode === "line" ? {
              tooltip: {
                showRule: "follow_cross" as const,
                showType: "standard" as const,
                legend: {
                  template: ({ current }: { current: KLineData | null }) => [{
                    title: "数值: ",
                    value: current ? current.close.toLocaleString("zh-CN", { maximumFractionDigits: 4 }) : "--"
                  }]
                }
              }
            } : {})
          },
          xAxis: { tickText: { color: "#94a3b8", size: 11 } },
          yAxis: { tickText: { color: "#94a3b8", size: 11 } },
          crosshair: {
            horizontal: { line: { color: "#64748b", size: 1, style: "dashed", dashedValue: [4, 4] } },
            vertical: { line: { color: "#64748b", size: 1, style: "dashed", dashedValue: [4, 4] } }
          }
        }
      });
      if (!chart) return;
      chartInstance = chart;
      chartRef.current = chart;
      chart.setDataLoader({
        getBars: ({ callback }) => callback(data, { backward: false, forward: false })
      });
      chart.setSymbol({ ticker, pricePrecision: 4, volumePrecision: 0 });
      chart.setPeriod(period);
      chart.setBarSpace(mode === "candlestick" ? 9 : 6);
      chart.setOffsetRightDistance(36);
      chart.setZoomEnabled(true);
      chart.setScrollEnabled(true);
      chart.scrollToRealTime();
      observer = new ResizeObserver(() => chart.resize());
      observer.observe(containerRef.current);
      setReady(true);
    });

    return () => {
      cancelled = true;
      observer?.disconnect();
      if (chartInstance) {
        void import("klinecharts").then(({ dispose }) => dispose(chartInstance as Chart));
      }
      chartRef.current = null;
    };
  }, [data, mode, period, ticker]);

  if (data.length === 0) {
    return <div className="flex h-80 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-500">{emptyText}</div>;
  }

  return (
    <div className="relative h-80 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      {!ready ? <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">正在初始化专业图表...</div> : null}
      <div ref={containerRef} className="h-full w-full" aria-label={`${ticker}专业互动${mode === "candlestick" ? "K线" : "趋势"}图`} />
    </div>
  );
}
