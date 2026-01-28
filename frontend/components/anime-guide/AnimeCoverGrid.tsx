"use client";

import Link from "next/link";
import { ImageIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type AnimeGuideItem = {
  id: string;
  title: string;
  chineseTitle?: string | null;
  originalTitle?: string | null;
  coverUrl: string;
  updateTime?: string | null;
  episode?: string | null;
  rating?: number | null;
  detailId?: string;
};

const renderEpisode = (item: AnimeGuideItem) => {
  if (item.updateTime && item.episode) {
    return `${item.updateTime} · ${item.episode}`;
  }
  return item.updateTime || item.episode || "更新时间待定";
};

const renderRating = (rating?: number | null) => {
  if (rating === null || rating === undefined || Number.isNaN(rating)) {
    return "--/5.0";
  }
  return `${rating.toFixed(1)}/5.0`;
};

const getRatingClass = (rating?: number | null) => {
  if (rating === null || rating === undefined || Number.isNaN(rating)) {
    return "text-slate-400";
  }
  if (rating >= 4.0) return "text-emerald-600";
  if (rating >= 3.0) return "text-sky-600";
  if (rating >= 2.0) return "text-amber-600";
  return "text-rose-600";
};

type AnimeCoverGridProps = {
  items: AnimeGuideItem[];
  rangeLabel?: string;
};

export function AnimeCoverGrid({ items, rangeLabel }: AnimeCoverGridProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-slate-900">封面墙</div>
          <div className="text-xs text-slate-500">共 {items.length} 部</div>
        </div>
        <div className="flex items-center gap-3">
          {rangeLabel ? (
            <div className="text-xs text-slate-500">{rangeLabel}</div>
          ) : null}
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <ImageIcon className="h-4 w-4" />
          </div>
        </div>
      </div>

      <div className="mt-4 min-h-0 flex-1 pr-2">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {items.map((item) => {
            const detailId = item.detailId ?? item.id;
            return (
              <Link
                key={item.id}
                href={`/apps/anime-guide/${detailId}`}
                className="group flex flex-col overflow-hidden rounded-lg border border-slate-100 bg-slate-50 transition hover:border-slate-200 hover:bg-white"
              >
                <div className="relative aspect-[3/4] overflow-hidden">
                  <img
                    src={item.coverUrl}
                    alt={item.title}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                </div>
                <div className="space-y-1 p-3">
                  <div className="truncate text-sm font-medium text-slate-900">
                    {item.chineseTitle || item.title}
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="min-w-0 truncate">{renderEpisode(item)}</span>
                    <span className={cn("ml-2 shrink-0", getRatingClass(item.rating))}>
                      {renderRating(item.rating)}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
        {/* loadMore: 后续接入接口后，可在滚动触底时加载更多 */}
      </div>
    </div>
  );
}
