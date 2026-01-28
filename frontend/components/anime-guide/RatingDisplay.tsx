"use client";

import { Star } from "lucide-react";

import { cn } from "@/lib/utils";

type RatingDisplayProps = {
  rating: number;
};

export function RatingDisplay({ rating }: RatingDisplayProps) {
  const filledCount = Math.floor(rating);
  const stars = Array.from({ length: 5 }, (_, index) => index + 1);

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        {stars.map((star) => (
          <Star
            key={star}
            className={cn(
              "h-4 w-4",
              star <= filledCount ? "fill-slate-900 text-slate-900" : "text-slate-300"
            )}
          />
        ))}
      </div>
      <div className="text-sm font-semibold text-slate-900">{rating.toFixed(1)}</div>
      <div className="text-xs text-slate-400">/ 5.0</div>
    </div>
  );
}
