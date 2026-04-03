"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import { ArrowRight, LineChart, ShieldCheck, Coins, Boxes, Landmark } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { AuthGuard } from "@/components/AuthGuard";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type ModuleCard = {
  key: string;
  title: string;
  subtitle: string;
  description: string;
  href: string;
  tags: string[];
  visibleTagCount: number;
  borderClass: string;
  iconClass: string;
  overflowTagClass: string;
  Icon: ComponentType<{ className?: string }>;
};

const moduleCards: ModuleCard[] = [
  {
    key: "nasdaq",
    title: "纳斯达克",
    subtitle: "成长股风险偏好",
    description: "科技相对强度、波动率、资金利率与信用利差等核心宏观指标。",
    href: "/apps/invest-weather-station/nasdaq",
    tags: ["DGS10", "FEDFUNDS", "VXN", "HYD", "CPI", "INDPRO", "NASDAQCOM", "NASDAQ100", "DFII10", "DTWEXBGS", "STLFSI4", "T10Y2Y"],
    visibleTagCount: 6,
    borderClass: "border-indigo-300/80",
    iconClass: "bg-indigo-100 text-indigo-600",
    overflowTagClass: "border-indigo-200 bg-indigo-50 text-indigo-600",
    Icon: LineChart
  },
  {
    key: "sp500",
    title: "标普500",
    subtitle: "美国经济基本面",
    description: "失业率、VIX、高收益债利差、金融压力指数等硬着陆观察项。",
    href: "/apps/invest-weather-station/sp500",
    tags: ["DGS10", "FEDFUNDS", "UNRATE", "VIX", "DXY", "Stress", "HY", "T10Y2Y", "CPI", "INDPRO", "SP500"],
    visibleTagCount: 6,
    borderClass: "border-blue-300/80",
    iconClass: "bg-blue-100 text-blue-600",
    overflowTagClass: "border-blue-200 bg-blue-50 text-blue-600",
    Icon: ShieldCheck
  },
  {
    key: "gold",
    title: "黄金",
    subtitle: "硬通货核心驱动",
    description: "实际利率、通胀预期、美元指数与就业等指标组合观察。",
    href: "/apps/invest-weather-station/gold",
    tags: ["DFII10", "T10YIE", "DXY", "UNRATE", "金银比", "铜金比", "WALCL", "PAYEMS"],
    visibleTagCount: 6,
    borderClass: "border-amber-300/80",
    iconClass: "bg-amber-100 text-amber-600",
    overflowTagClass: "border-amber-300 bg-amber-50 text-amber-700",
    Icon: Coins
  },
  {
    key: "hk",
    title: "港股恒生",
    subtitle: "成长与红利风格切换",
    description: "恒生、恒生科技、红利低波、美元利率与南向资金的组合观察。",
    href: "/apps/invest-weather-station/hk",
    tags: ["HSI", "HSTECH", "HSHYLV", "Style Rotation", "DGS10", "DFII10", "DXY", "NFCI", "USDHKD", "南向资金"],
    visibleTagCount: 6,
    borderClass: "border-rose-300/80",
    iconClass: "bg-rose-100 text-rose-600",
    overflowTagClass: "border-rose-200 bg-rose-50 text-rose-700",
    Icon: Landmark
  },
  {
    key: "cs2",
    title: "CS2 饰品",
    subtitle: "虚拟资产交易温度",
    description: "抓取 SteamDT 首页聚合数据，观察大盘、成交、新增与板块涨跌排行。",
    href: "/apps/invest-weather-station/cs2",
    tags: ["大盘指数", "成交额", "成交量", "新增额", "新增量", "存世量", "热门板块", "一级板块", "二级板块", "三级板块"],
    visibleTagCount: 6,
    borderClass: "border-emerald-300/80",
    iconClass: "bg-emerald-100 text-emerald-600",
    overflowTagClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    Icon: Boxes
  }
];

export default function InvestWeatherStationPage() {
  return (
    <AuthGuard>
      <AppShell>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">投资气象站</h1>
          <p className="text-sm text-slate-500">
            五大板块指标监控：纳斯达克、标普500、黄金、港股恒生、CS2 饰品
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {moduleCards.map((moduleCard) => {
            const Icon = moduleCard.Icon;
            const visibleTags = moduleCard.tags.slice(0, moduleCard.visibleTagCount);
            const hiddenTagCount = Math.max(moduleCard.tags.length - visibleTags.length, 0);
            return (
              <Card
                key={moduleCard.key}
                className={`h-full border-2 bg-white/95 transition hover:-translate-y-0.5 hover:shadow-md ${moduleCard.borderClass}`}
              >
                <CardHeader className="space-y-3 pb-3">
                  <div className="flex items-start gap-3">
                    <div className={`rounded-xl p-2 ${moduleCard.iconClass}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-xl">{moduleCard.title}</CardTitle>
                      <CardDescription className="mt-1">{moduleCard.subtitle}</CardDescription>
                    </div>
                  </div>
                  <p className="text-sm leading-6 text-slate-600">{moduleCard.description}</p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {visibleTags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600"
                      >
                        {tag}
                      </span>
                    ))}
                    {hiddenTagCount > 0 ? (
                      <span
                        className={`rounded-md border px-2 py-1 text-xs font-semibold ${moduleCard.overflowTagClass}`}
                      >
                        +{hiddenTagCount}项
                      </span>
                    ) : null}
                  </div>
                  <Link
                    href={moduleCard.href}
                    className={`${buttonVariants({ variant: "default" })} w-full gap-2`}
                  >
                    进入仪表盘
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </AppShell>
    </AuthGuard>
  );
}
