"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type EpisodeChipsProps = {
  episodes: number[];
  startDate: string;
};

const parseStartDate = (value: string) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  const match = trimmed.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (match) {
    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  return null;
};

const getAiredCount = (startDate: string, totalEpisodes: number) => {
  const start = parseStartDate(startDate);
  if (!start) return 0;
  const today = new Date();
  const startAt = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const todayAt = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.floor((todayAt.getTime() - startAt.getTime()) / 86400000);
  if (diffDays < 0) return 0;
  const count = Math.floor(diffDays / 7) + 1;
  return Math.min(Math.max(count, 0), totalEpisodes);
};

export function EpisodeChips({ episodes, startDate }: EpisodeChipsProps) {
  const [selectedEpisode, setSelectedEpisode] = useState<number | null>(null);
  const airedCount = useMemo(
    () => getAiredCount(startDate, episodes.length),
    [startDate, episodes.length]
  );
  const currentEpisode = useMemo(() => {
    if (airedCount <= 0) return episodes[0] ?? null;
    return Math.min(airedCount, episodes[episodes.length - 1] ?? airedCount);
  }, [airedCount, episodes]);

  useEffect(() => {
    setSelectedEpisode(currentEpisode ?? null);
  }, [currentEpisode]);

  return (
    <div className="flex flex-wrap gap-2">
      {episodes.map((episode) => {
        const label = String(episode).padStart(2, "0");
        const active = selectedEpisode === episode;
        const isAired = episode <= airedCount;
        return (
          <Button
            key={episode}
            type="button"
            variant={active ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedEpisode(episode)}
            className={cn(
              "h-8 px-3 text-xs",
              active
                ? "shadow-sm"
                : isAired
                ? "border-slate-200 text-slate-400"
                : "text-slate-600"
            )}
          >
            {label}
          </Button>
        );
      })}
    </div>
  );
}
