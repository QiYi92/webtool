"use client";

import { useEffect, useMemo, useState } from "react";

import { AuthGuard } from "@/components/AuthGuard";
import { AppShell } from "@/components/AppShell";
import { AnimeCoverGrid } from "@/components/anime-guide/AnimeCoverGrid";
import { MiniCalendar } from "@/components/anime-guide/MiniCalendar";
import { UpdateList } from "@/components/anime-guide/UpdateList";
import { WeekdayTabs } from "@/components/anime-guide/WeekdayTabs";
import { fetchJSON } from "@/lib/api";
import { formatDateString } from "@/lib/mock/animeGuideMock";

type AnimeGuideApiItem = {
  id: string;
  title: string;
  chineseTitle?: string;
  originalTitle?: string;
  coverUrl: string;
  weekday: number;
  date: string;
  updateTime?: string | null;
  episode?: string | null;
  rating?: number | null;
};

export function AnimeGuidePage() {
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [selectedWeekday, setSelectedWeekday] = useState<number>(() => new Date().getDay());
  const [currentMonth, setCurrentMonth] = useState(() => {
    const base = new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [updateDateSet, setUpdateDateSet] = useState<Set<string>>(() => new Set());
  const [updatesForDate, setUpdatesForDate] = useState<AnimeGuideApiItem[]>([]);
  const [weekItems, setWeekItems] = useState<AnimeGuideApiItem[]>([]);
  const [lastCrawledAt, setLastCrawledAt] = useState<string | null>(null);

  const effectiveDateString = formatDateString(selectedDate);

  const weekRange = useMemo(() => {
    const day = selectedDate.getDay();
    const offset = (day + 6) % 7; // Monday as start
    const start = new Date(selectedDate);
    start.setDate(selectedDate.getDate() - offset);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start, end };
  }, [selectedDate]);

  const weekRangeLabel = useMemo(() => {
    const startMonth = weekRange.start.getMonth() + 1;
    const startDay = weekRange.start.getDate();
    const endMonth = weekRange.end.getMonth() + 1;
    const endDay = weekRange.end.getDate();
    return `显示范围：${startMonth}月${startDay}日-${endMonth}月${endDay}日`;
  }, [weekRange]);

  const filteredWeekItems = useMemo(() => {
    return weekItems.filter((item) => item.weekday === selectedWeekday);
  }, [weekItems, selectedWeekday]);

  useEffect(() => {
    const loadCalendar = async () => {
      const start = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
      const end = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
      try {
        const data = await fetchJSON<{ dates: string[] }>(
          `/tools/anime-guide/calendar?start=${formatDateString(start)}&end=${formatDateString(end)}`
        );
        setUpdateDateSet(new Set(data.dates ?? []));
      } catch (error) {
        setUpdateDateSet(new Set());
      }
    };

    loadCalendar();
  }, [currentMonth]);

  useEffect(() => {
    const loadCrawlStatus = async () => {
      try {
        const data = await fetchJSON<{ lastCrawledAt: string | null }>(
          "/tools/anime-guide/crawl-status"
        );
        setLastCrawledAt(data.lastCrawledAt ?? null);
      } catch (error) {
        setLastCrawledAt(null);
      }
    };

    loadCrawlStatus();
  }, []);

  const crawlTimeLabel = useMemo(() => {
    if (!lastCrawledAt) {
      return "数据爬取时间：--";
    }
    const parsed = new Date(lastCrawledAt);
    if (Number.isNaN(parsed.getTime())) {
      return "数据爬取时间：--";
    }
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    const hours = String(parsed.getHours()).padStart(2, "0");
    const minutes = String(parsed.getMinutes()).padStart(2, "0");
    const seconds = String(parsed.getSeconds()).padStart(2, "0");
    return `数据爬取时间：${year}年${month}月${day}日 ${hours}:${minutes}:${seconds}`;
  }, [lastCrawledAt]);

  useEffect(() => {
    setSelectedWeekday(selectedDate.getDay());
  }, [selectedDate]);

  useEffect(() => {
    const loadUpdates = async () => {
      try {
        const data = await fetchJSON<{ items: AnimeGuideApiItem[] }>(
          `/tools/anime-guide/updates?date=${effectiveDateString}`
        );
        setUpdatesForDate(data.items ?? []);
      } catch (error) {
        setUpdatesForDate([]);
      }
    };

    loadUpdates();
  }, [effectiveDateString]);

  useEffect(() => {
    const loadWeekItems = async () => {
      const dates = Array.from({ length: 7 }).map((_, index) => {
        const date = new Date(weekRange.start);
        date.setDate(weekRange.start.getDate() + index);
        return formatDateString(date);
      });
      try {
        const responses = await Promise.all(
          dates.map((date) =>
            fetchJSON<{ items: AnimeGuideApiItem[] }>(`/tools/anime-guide/updates?date=${date}`)
          )
        );
        const items = responses.flatMap((response) => response.items ?? []);
        const uniqueMap = new Map(items.map((item) => [item.id, item]));
        setWeekItems(Array.from(uniqueMap.values()));
      } catch (error) {
        setWeekItems([]);
      }
    };

    loadWeekItems();
  }, [weekRange]);

  return (
    <AuthGuard>
      <AppShell>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">新番导视</h1>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
            <span>按日期与星期快速查看新番更新。</span>
            <span className="text-xs text-slate-400">{crawlTimeLabel}</span>
          </div>
        </div>
        <div className="flex min-h-[calc(100vh-140px)] flex-col gap-6 lg:flex-row">
          <section className="flex min-h-0 w-full flex-col gap-4 lg:w-[340px] lg:shrink-0">
            <MiniCalendar
              selectedDate={selectedDate}
              onDateSelect={setSelectedDate}
              updateDateSet={updateDateSet}
              currentMonth={currentMonth}
              onMonthChange={setCurrentMonth}
            />
            <UpdateList dateString={effectiveDateString} items={updatesForDate} />
          </section>

          <section className="flex min-h-0 flex-1 flex-col gap-4">
            <WeekdayTabs selectedWeekday={selectedWeekday} onChange={setSelectedWeekday} />
            <AnimeCoverGrid items={filteredWeekItems} rangeLabel={weekRangeLabel} />
          </section>
        </div>
      </AppShell>
    </AuthGuard>
  );
}
