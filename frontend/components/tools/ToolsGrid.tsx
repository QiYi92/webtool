"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchJSON } from "@/lib/api";
import { tools } from "@/lib/tools";
import { cn } from "@/lib/utils";

const formatDateString = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export function ToolsGrid() {
  const [animeGuideCount, setAnimeGuideCount] = useState<number | null>(null);
  const todayString = useMemo(() => formatDateString(new Date()), []);

  useEffect(() => {
    const loadAnimeGuideCount = async () => {
      try {
        const data = await fetchJSON<{ items: unknown[] }>(
          `/tools/anime-guide/updates?date=${todayString}`
        );
        setAnimeGuideCount(Array.isArray(data.items) ? data.items.length : 0);
      } catch (error) {
        setAnimeGuideCount(null);
      }
    };

    loadAnimeGuideCount();
  }, [todayString]);

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
          const card = (
            <Card
              className={cn(
                "min-h-[160px] border-slate-200 bg-white transition hover:border-slate-300 hover:shadow-sm",
                tool.disabled ? "pointer-events-none opacity-60" : "cursor-pointer"
              )}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-lg bg-slate-100 p-2 text-slate-600">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="text-base">{tool.title}</CardTitle>
                    <CardDescription className="mt-1 text-xs">
                      {tool.description}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {tool.disabled ? (
                  <div className="text-xs text-slate-500">即将上线</div>
                ) : isAnimeGuide ? (
                  <div className="text-xs text-slate-500">
                    今日新番更新{" "}
                    <span className="font-semibold text-slate-700">
                      {animeGuideCount === null ? "--" : animeGuideCount}
                    </span>{" "}
                    部
                  </div>
                ) : (
                  <div className="text-xs text-slate-400">点击进入</div>
                )}
              </CardContent>
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
