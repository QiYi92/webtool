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
  const todayString = useMemo(() => formatDateString(new Date()), []);
  const currentAnime = todayAnimeItems[titleIndex];

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

  const flipClassName = cn(
    "truncate transform-gpu text-base font-medium text-slate-700 transition-all duration-300 will-change-transform [backface-visibility:hidden]",
    flipPhase === "idle" && "translate-y-0 opacity-100 [transform:rotateX(0deg)]",
    flipPhase === "leaving" && "-translate-y-1 opacity-0 [transform:rotateX(68deg)]",
    flipPhase === "entering" && "translate-y-1 opacity-0 [transform:rotateX(-68deg)]"
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
