"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchJSON } from "@/lib/api";
import { tools } from "@/lib/tools";
import { cn } from "@/lib/utils";

type AnimeGuideCardItem = {
  id: string;
  title?: string;
  chineseTitle?: string | null;
  coverUrl?: string | null;
};

type FlipPhase = "idle" | "leaving" | "entering";
type AnimeGuideDisplayItem = {
  title: string;
  coverUrl: string;
};
type InvestWeatherCard = {
  name: string;
  value: number | null;
  unit: string;
  secondaryValue: number | null;
};
type InvestWeatherApiResponse = {
  sections?: Array<{
    key: string;
    cards?: InvestWeatherCard[];
  }>;
};
type InvestWeatherDisplayItem = {
  marketLabel: string;
  name: string;
  value: number | null;
  unit: string;
  secondaryValue: number | null;
};

const formatDateString = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export function ToolsGrid() {
  const [animeGuideCount, setAnimeGuideCount] = useState<number | null>(null);
  const [todayAnimeItems, setTodayAnimeItems] = useState<AnimeGuideDisplayItem[]>([]);
  const [titleIndex, setTitleIndex] = useState(0);
  const [flipPhase, setFlipPhase] = useState<FlipPhase>("idle");
  const [investItems, setInvestItems] = useState<InvestWeatherDisplayItem[]>([]);
  const [investIndex, setInvestIndex] = useState(0);
  const [investFlipPhase, setInvestFlipPhase] = useState<FlipPhase>("idle");
  const todayString = useMemo(() => formatDateString(new Date()), []);
  const currentAnime = todayAnimeItems[titleIndex];
  const currentInvest = investItems[investIndex];

  useEffect(() => {
    const loadAnimeGuideCount = async () => {
      try {
        const data = await fetchJSON<{ items: AnimeGuideCardItem[] }>(
          `/tools/anime-guide/updates?date=${todayString}`
        );
        const items = Array.isArray(data.items) ? data.items : [];
        const displayItems = items
          .map((item) => ({
            title: (item.chineseTitle || item.title || "").trim(),
            coverUrl: (item.coverUrl || "").trim()
          }))
          .filter((item) => item.title.length > 0);
        setAnimeGuideCount(items.length);
        setTodayAnimeItems(displayItems);
        setTitleIndex(0);
        setFlipPhase("idle");
      } catch (error) {
        setAnimeGuideCount(null);
        setTodayAnimeItems([]);
        setTitleIndex(0);
        setFlipPhase("idle");
      }
    };

    loadAnimeGuideCount();
  }, [todayString]);

  useEffect(() => {
    if (todayAnimeItems.length <= 1) {
      setFlipPhase("idle");
      return;
    }

    let stopped = false;
    let switchTimer: ReturnType<typeof setTimeout> | null = null;
    let loopTimer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      loopTimer = setTimeout(() => {
        if (stopped) return;
        setFlipPhase("leaving");

        switchTimer = setTimeout(() => {
          if (stopped) return;
          setTitleIndex((prev) => (prev + 1) % todayAnimeItems.length);
          setFlipPhase("entering");
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (!stopped) {
                setFlipPhase("idle");
              }
            });
          });
          schedule();
        }, 360);
      }, 4200);
    };

    schedule();

    return () => {
      stopped = true;
      if (loopTimer) clearTimeout(loopTimer);
      if (switchTimer) clearTimeout(switchTimer);
    };
  }, [todayAnimeItems.length]);

  useEffect(() => {
    const loadInvestWeather = async () => {
      try {
        const fetchLocalApi = async (url: string): Promise<InvestWeatherApiResponse> => {
          const response = await fetch(url, { method: "GET" });
          if (!response.ok) {
            throw new Error(`Failed to fetch ${url}`);
          }
          return (await response.json()) as InvestWeatherApiResponse;
        };

        const [nasdaq, sp500, gold, hk, cs2] = await Promise.all([
          fetchLocalApi("/api/invest-weather/nasdaq"),
          fetchLocalApi("/api/invest-weather/sp500"),
          fetchLocalApi("/api/invest-weather/gold"),
          fetchLocalApi("/api/invest-weather/hk"),
          fetchLocalApi("/api/invest-weather/cs2")
        ]);

        const toMarketItem = (
          payload: InvestWeatherApiResponse,
          marketLabel: string
        ): InvestWeatherDisplayItem | null => {
          const marketSection = (payload.sections || []).find((section) => section.key === "market");
          const card = marketSection?.cards?.[0];
          if (!card) return null;
          return {
            marketLabel,
            name: card.name,
            value: card.value,
            unit: card.unit || "",
            secondaryValue: card.secondaryValue
          };
        };

        const items = [
          toMarketItem(nasdaq, "纳斯达克"),
          toMarketItem(sp500, "标普500"),
          toMarketItem(gold, "黄金"),
          toMarketItem(hk, "港股恒生"),
          toMarketItem(cs2, "CS2 饰品")
        ].filter((item): item is InvestWeatherDisplayItem => item !== null);

        setInvestItems(items);
        setInvestIndex(0);
        setInvestFlipPhase("idle");
      } catch (error) {
        setInvestItems([]);
        setInvestIndex(0);
        setInvestFlipPhase("idle");
      }
    };

    loadInvestWeather();
  }, []);

  useEffect(() => {
    if (investItems.length <= 1) {
      setInvestFlipPhase("idle");
      return;
    }

    let stopped = false;
    let switchTimer: ReturnType<typeof setTimeout> | null = null;
    let loopTimer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      loopTimer = setTimeout(() => {
        if (stopped) return;
        setInvestFlipPhase("leaving");

        switchTimer = setTimeout(() => {
          if (stopped) return;
          setInvestIndex((prev) => (prev + 1) % investItems.length);
          setInvestFlipPhase("entering");
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (!stopped) {
                setInvestFlipPhase("idle");
              }
            });
          });
          schedule();
        }, 360);
      }, 4200);
    };

    schedule();

    return () => {
      stopped = true;
      if (loopTimer) clearTimeout(loopTimer);
      if (switchTimer) clearTimeout(switchTimer);
    };
  }, [investItems.length]);

  const formatInvestValue = (value: number | null, unit: string) => {
    if (value === null || Number.isNaN(value)) return "--";
    const digits = Math.abs(value) >= 100 ? 2 : 3;
    const formatted = value.toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
    return `${formatted}${unit ? ` ${unit}` : ""}`;
  };

  const formatInvestChange = (value: number | null) => {
    if (value === null || Number.isNaN(value)) return "--";
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
  };

  const investChangeClass =
    currentInvest?.secondaryValue === null || currentInvest?.secondaryValue === undefined
      ? "text-slate-400"
      : currentInvest.secondaryValue > 0
        ? "text-emerald-600"
        : currentInvest.secondaryValue < 0
          ? "text-rose-600"
          : "text-slate-500";

  const flipClassName = cn(
    "truncate transform-gpu text-base font-medium text-slate-700 transition-all duration-300 will-change-transform [backface-visibility:hidden]",
    flipPhase === "idle" && "translate-y-0 opacity-100 [transform:rotateX(0deg)]",
    flipPhase === "leaving" && "-translate-y-1 opacity-0 [transform:rotateX(68deg)]",
    flipPhase === "entering" && "translate-y-1 opacity-0 [transform:rotateX(-68deg)]"
  );
  const investFlipClassName = cn(
    "truncate transform-gpu text-base font-medium text-slate-700 transition-all duration-300 will-change-transform [backface-visibility:hidden]",
    investFlipPhase === "idle" && "translate-y-0 opacity-100 [transform:rotateX(0deg)]",
    investFlipPhase === "leaving" && "-translate-y-1 opacity-0 [transform:rotateX(68deg)]",
    investFlipPhase === "entering" && "translate-y-1 opacity-0 [transform:rotateX(-68deg)]"
  );
  const coverClassName = cn(
    "h-full w-full object-cover transition-opacity duration-500",
    flipPhase === "leaving" || flipPhase === "entering" ? "opacity-0" : "opacity-100"
  );

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">工具</h2>
        <p className="text-sm text-slate-500">选择一个工具开始使用</p>
      </div>

      <div className="grid gap-6 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {tools.map((tool) => {
          const Icon = tool.icon;
          const isAnimeGuide = tool.key === "anime-guide";
          const isInvestWeather = tool.key === "invest-weather-station";
          const useGuideStyle = !tool.disabled;
          const card = (
            <Card
              className={cn(
                "h-[160px] overflow-hidden border-slate-200 bg-white transition hover:border-slate-300 hover:shadow-sm",
                isAnimeGuide && "relative",
                tool.disabled ? "pointer-events-none opacity-60" : "cursor-pointer"
              )}
            >
              <CardHeader className={cn(isAnimeGuide ? "pb-2 pr-[156px]" : "pb-1")}>
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-lg bg-slate-100 p-2 text-slate-600">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <CardTitle className={cn(useGuideStyle ? "text-lg" : "text-base")}>
                      {tool.title}
                    </CardTitle>
                    <CardDescription className={cn("mt-1", useGuideStyle ? "text-sm" : "text-xs")}>
                      {tool.description}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className={cn("pt-0", isAnimeGuide && "pb-5 pr-[156px]")}>
                {tool.disabled ? (
                  <div className="text-xs text-slate-500">即将上线</div>
                ) : isAnimeGuide ? (
                  <div className="flex h-[72px] items-start">
                    <div className="min-w-0 flex flex-1 flex-col gap-2">
                      <div className="text-sm text-slate-600">
                        今日新番更新{" "}
                        <span className="text-lg font-semibold text-slate-800">
                          {animeGuideCount === null ? "--" : animeGuideCount}
                        </span>{" "}
                        部
                      </div>
                      <div className="h-6 overflow-hidden [perspective:900px]">
                        {animeGuideCount === null ? (
                          <div className="text-sm text-slate-400">更新信息加载中...</div>
                        ) : todayAnimeItems.length === 0 ? (
                          <div className="text-sm text-slate-400">今天暂无新番更新</div>
                        ) : (
                          <div className={flipClassName}>{currentAnime?.title}</div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : isInvestWeather ? (
                  <div className="flex h-[72px] items-start">
                    <div className="min-w-0 flex flex-1 flex-col justify-center gap-1">
                      <div className="text-sm text-slate-600">实时指数速览</div>
                      <div className="h-6 overflow-hidden [perspective:900px]">
                        {investItems.length === 0 ? (
                          <div className="text-sm text-slate-400">行情数据加载中...</div>
                        ) : (
                          <div className={investFlipClassName}>
                            {currentInvest?.marketLabel} · {currentInvest?.name}
                          </div>
                        )}
                      </div>
                      <div className="text-sm font-medium text-slate-700">
                        {formatInvestValue(currentInvest?.value ?? null, currentInvest?.unit ?? "")}
                        <span className={cn("ml-2 font-semibold", investChangeClass)}>
                          {formatInvestChange(currentInvest?.secondaryValue ?? null)}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className={cn(useGuideStyle ? "text-sm text-slate-600" : "text-xs text-slate-400")}>
                    点击进入
                  </div>
                )}
              </CardContent>
              {isAnimeGuide && (
                <div className="pointer-events-none absolute inset-y-4 right-4 w-[124px] overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                  {animeGuideCount === null ? (
                    <div className="h-full w-full animate-pulse bg-slate-200" />
                  ) : currentAnime?.coverUrl ? (
                    <img
                      src={currentAnime.coverUrl}
                      alt={currentAnime.title}
                      className={coverClassName}
                    />
                  ) : (
                    <div className="h-full w-full bg-slate-200" />
                  )}
                </div>
              )}
            </Card>
          );

          if (tool.disabled) {
            return (
              <div key={tool.key} className="h-full">
                {card}
              </div>
            );
          }

          return (
            <Link key={tool.key} href={tool.href} className="block h-full">
              {card}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
