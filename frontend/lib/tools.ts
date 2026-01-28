import type { LucideIcon } from "lucide-react";
import { Calendar, Sparkles, Search, Wrench, ListChecks, Compass } from "lucide-react";

export type ToolItem = {
  key: string;
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  disabled?: boolean;
};

export const tools: ToolItem[] = [
  {
    key: "anime-guide",
    title: "新番导视",
    description: "查看新番更新日历与详情",
    href: "/apps/anime-guide",
    icon: Calendar
  },
  {
    key: "tool-search",
    title: "全站检索",
    description: "快速搜索工具与内容",
    href: "#",
    icon: Search,
    disabled: true
  },
  {
    key: "tool-workflow",
    title: "任务清单",
    description: "聚合日常待办与提醒",
    href: "#",
    icon: ListChecks,
    disabled: true
  },
  {
    key: "tool-lab",
    title: "实验工坊",
    description: "管理个人实验与想法",
    href: "#",
    icon: Sparkles,
    disabled: true
  },
  {
    key: "tool-kit",
    title: "常用工具集",
    description: "快捷访问高频工具",
    href: "#",
    icon: Wrench,
    disabled: true
  },
  {
    key: "tool-discover",
    title: "灵感探索",
    description: "记录与追踪灵感来源",
    href: "#",
    icon: Compass,
    disabled: true
  }
];
