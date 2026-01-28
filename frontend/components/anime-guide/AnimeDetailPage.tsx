"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AuthGuard } from "@/components/AuthGuard";
import { AppShell } from "@/components/AppShell";
import { EpisodeChips } from "@/components/anime-guide/EpisodeChips";
import { RatingDisplay } from "@/components/anime-guide/RatingDisplay";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetchJSON } from "@/lib/api";
import { cn } from "@/lib/utils";

type AnimeDetailData = {
  id: string;
  title: string;
  coverUrl: string;
  chineseTitle: string;
  totalEpisodes: number;
  startDate: string | null;
  weekdayText: string;
  episodes: number[];
  synopsis: string;
  rating: number;
  formatTag?: string;
};

const InfoRow = ({ label, value }: { label: string; value: string }) => {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm font-medium text-slate-900">{value}</div>
    </div>
  );
};

export function AnimeDetailPage({ id }: { id: string }) {
  const [detail, setDetail] = useState<AnimeDetailData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchJSON<{ detail: AnimeDetailData }>(
          `/tools/anime-guide/detail/${id}`
        );
        if (mounted) {
          setDetail(data.detail);
        }
      } catch (error) {
        if (mounted) {
          setDetail(null);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [id]);

  return (
    <AuthGuard>
      <AppShell>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs text-slate-500">新番导视</div>
            <h1 className="text-2xl font-semibold text-slate-900">番剧详情</h1>
          </div>
          <Link
            href="/apps/anime-guide"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "flex items-center gap-2"
            )}
          >
            <ArrowLeft className="h-4 w-4" />
            返回列表
          </Link>
        </div>

        {!detail && !loading ? (
          <Card className="p-6">
            <div className="text-sm text-slate-500">未找到该番剧。</div>
            <Link
              href="/apps/anime-guide"
              className={cn(buttonVariants({ variant: "outline" }), "mt-4 inline-flex")}
            >
              返回新番导视
            </Link>
          </Card>
        ) : loading ? (
          <Card className="p-6">
            <div className="text-sm text-slate-500">正在加载番剧信息...</div>
          </Card>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-semibold text-slate-900">
                  {detail.chineseTitle || detail.title}
                </h2>
                {detail.formatTag ? (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                    {detail.formatTag}
                  </span>
                ) : null}
              </div>
              <div className="text-sm text-slate-500">{detail.title}</div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-stretch">
              <div className="flex flex-col gap-6">
                <Card className="overflow-hidden">
                  <div className="aspect-[3/4] w-full">
                    <img
                      src={detail.coverUrl}
                      alt={detail.title}
                      className="h-full w-full object-cover"
                    />
                  </div>
                </Card>

                <Card className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-900">基本信息</div>
                    <RatingDisplay rating={detail.rating} />
                  </div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <InfoRow label="中文名" value={detail.chineseTitle} />
                    <InfoRow label="话数" value={`${detail.totalEpisodes} 话`} />
                    <InfoRow label="放送开始" value={detail.startDate} />
                    <InfoRow label="放送星期" value={detail.weekdayText} />
                  </div>
                </Card>
              </div>

              <div className="flex flex-col gap-6 lg:h-full">
                <Card className="p-4">
                  <div className="text-sm font-semibold text-slate-900">章节列表</div>
                  <div className="mt-3">
                    <EpisodeChips
                      episodes={detail.episodes}
                      startDate={detail.startDate || ""}
                    />
                  </div>
                </Card>

                <Card className="flex flex-1 flex-col p-4">
                  <div className="text-sm font-semibold text-slate-900">简介</div>
                  <p className="mt-3 flex-1 whitespace-pre-line text-sm text-slate-600">
                    {detail.synopsis}
                  </p>
                </Card>
              </div>
            </div>
          </div>
        )}
      </AppShell>
    </AuthGuard>
  );
}
