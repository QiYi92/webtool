"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatDateString } from "@/lib/mock/animeGuideMock";
import { cn } from "@/lib/utils";

const WEEKDAY_HEADERS = ["日", "一", "二", "三", "四", "五", "六"];

type MiniCalendarProps = {
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
  updateDateSet: Set<string>;
  currentMonth: Date;
  onMonthChange: (nextMonth: Date) => void;
};

export function MiniCalendar({
  selectedDate,
  onDateSelect,
  updateDateSet,
  currentMonth,
  onMonthChange
}: MiniCalendarProps) {
  const monthLabel = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = String(currentMonth.getMonth() + 1).padStart(2, "0");
    return `${year}年${month}月`;
  }, [currentMonth]);

  const days = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const cells = Array.from({ length: Math.ceil((firstDay + totalDays) / 7) * 7 });

    return cells.map((_, index) => {
      const dayNumber = index - firstDay + 1;
      if (dayNumber < 1 || dayNumber > totalDays) {
        return null;
      }
      return new Date(year, month, dayNumber);
    });
  }, [currentMonth]);

  const todayString = formatDateString(new Date());
  const selectedString = formatDateString(selectedDate);

  const handlePrevMonth = () => {
    onMonthChange(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    onMonthChange(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-900">{monthLabel}</div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={handlePrevMonth} aria-label="上一月">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleNextMonth} aria-label="下一月">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs text-slate-500">
        {WEEKDAY_HEADERS.map((label) => (
          <div key={label} className="py-1">
            {label}
          </div>
        ))}
      </div>

      <div className="mt-1 grid grid-cols-7 gap-1">
        {days.map((date, index) => {
          if (!date) {
            return <div key={`empty-${index}`} className="h-9" />;
          }

          const dateString = formatDateString(date);
          const isToday = dateString === todayString;
          const isSelected = dateString === selectedString;
          const hasUpdates = updateDateSet.has(dateString);

          return (
            <button
              key={dateString}
              type="button"
              onClick={() => onDateSelect(date)}
              className={cn(
                "relative flex h-9 w-full items-center justify-center rounded-md text-sm transition",
                isSelected
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-100",
                isToday && !isSelected ? "border border-slate-900" : ""
              )}
            >
              {date.getDate()}
              {hasUpdates ? (
                <span
                  className={cn(
                    "absolute bottom-1 h-1.5 w-1.5 rounded-full",
                    isSelected ? "bg-white" : "bg-slate-500"
                  )}
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
