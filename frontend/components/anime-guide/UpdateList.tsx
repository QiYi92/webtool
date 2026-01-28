"use client";

import Link from "next/link";
import { ScrollText } from "lucide-react";

type AnimeGuideItem = {
  id: string;
  title: string;
  chineseTitle?: string | null;
  originalTitle?: string | null;
  coverUrl: string;
  updateTime?: string | null;
  episode?: string | null;
  detailId?: string;
};

const renderSubtitle = (item: AnimeGuideItem) => {
  if (item.updateTime && item.episode) {
    return `${item.updateTime} · ${item.episode}`;
  }
  return item.updateTime || item.episode || "更新时间待定";
};

type UpdateListProps = {
  dateString: string;
  items: AnimeGuideItem[];
};

export function UpdateList({ dateString, items }: UpdateListProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm max-h-[calc(100vh-240px)]">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900">{dateString} 更新列表</div>
          <div className="text-xs text-slate-500">共 {items.length} 条更新</div>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <ScrollText className="h-4 w-4" />
        </div>
      </div>

      <div className="mt-3 flex-1 overflow-y-auto pr-1">
        {items.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            当天暂无更新
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item, index) => {
              const detailId = item.detailId ?? item.id;
              return (
                <Link
                  key={`${item.id}-${dateString}-${index}`}
                  href={`/apps/anime-guide/${detailId}`}
                  className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 p-2 transition hover:border-slate-200 hover:bg-white"
                >
                  <img
                    src={item.coverUrl}
                    alt={item.title}
                    className="h-14 w-10 rounded-md object-cover"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">
                      {item.chineseTitle || item.title}
                    </div>
                    <div className="text-xs text-slate-500">{renderSubtitle(item)}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
