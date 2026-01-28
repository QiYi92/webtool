"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WEEKDAY_OPTIONS: Array<{ label: string; value: number }> = [
  { label: "周一", value: 1 },
  { label: "周二", value: 2 },
  { label: "周三", value: 3 },
  { label: "周四", value: 4 },
  { label: "周五", value: 5 },
  { label: "周六", value: 6 },
  { label: "周日", value: 0 }
];

type WeekdayTabsProps = {
  selectedWeekday: number;
  onChange: (weekday: number) => void;
};

export function WeekdayTabs({ selectedWeekday, onChange }: WeekdayTabsProps) {
  return (
    <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      {WEEKDAY_OPTIONS.map((item) => {
        const active = selectedWeekday === item.value;
        return (
          <Button
            key={item.value}
            type="button"
            variant={active ? "default" : "outline"}
            size="sm"
            onClick={() => onChange(item.value)}
            className={cn("px-4", active ? "shadow-sm" : "text-slate-600")}
            aria-pressed={active}
          >
            {item.label}
          </Button>
        );
      })}
    </div>
  );
}
