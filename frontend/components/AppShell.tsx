"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronsLeft,
  ChevronsRight,
  CalendarDays,
  Home,
  KeyRound,
  LineChart,
  MonitorCog,
  User,
  Workflow
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { fetchJSON } from "@/lib/api";
import { signOut } from "@/lib/auth";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

type NavGroup = {
  title: string;
  items?: NavItem[];
  sections?: Array<{
    title: string;
    items: NavItem[];
  }>;
};

type UserInfo = {
  id: string;
  username: string;
  email: string;
  role_group: string;
};

const SIDEBAR_KEY = "sidebar_collapsed";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);
  const pageTitle = useMemo(() => {
    if (pathname.startsWith("/apps/invest-weather-station")) {
      return "投资气象站";
    }
    if (pathname.startsWith("/apps/ai-workflow")) {
      return "AI工作流";
    }
    const map = new Map<string, string>([
      ["/", "主页"],
      ["/apps/anime-guide", "新番导视"],
      ["/apps/console/anime-crawler", "新番爬虫控制台"],
      ["/settings/account", "账号信息修改"],
      ["/settings/password", "密码修改"],
      ["/settings/permissions", "权限组管理"]
    ]);
    return map.get(pathname) ?? "控制台";
  }, [pathname]);

  const navGroups: NavGroup[] = useMemo(() => {
    const settingsItems: NavItem[] = [
      { label: "账号信息修改", href: "/settings/account", icon: User },
      { label: "密码修改", href: "/settings/password", icon: KeyRound }
    ];

    if (user?.role_group === "admin") {
      settingsItems.push({
        label: "权限组管理",
        href: "/settings/permissions",
        icon: User
      });
    }

    return [
      {
        title: "导航",
        items: [{ label: "主页", href: "/", icon: Home }]
      },
      {
        title: "应用",
        sections: [
          {
            title: "工具",
            items: [
              { label: "新番导视", href: "/apps/anime-guide", icon: CalendarDays },
              { label: "AI工作流", href: "/apps/ai-workflow", icon: Workflow },
              { label: "投资气象站", href: "/apps/invest-weather-station", icon: LineChart }
            ]
          },
          ...(user?.role_group === "admin"
            ? [
                {
                  title: "控制台",
                  items: [
                    {
                      label: "新番爬虫控制台",
                      href: "/apps/console/anime-crawler",
                      icon: MonitorCog
                    }
                  ]
                }
              ]
            : [])
        ]
      },
      {
        title: "系统设置",
        items: settingsItems
      }
    ];
  }, [user?.role_group]);

  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_KEY);
    setCollapsed(stored === "true");
  }, []);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const data = await fetchJSON<UserInfo>("/me");
        setUser(data);
      } catch (error) {
        signOut();
        router.replace("/login");
      }
    };

    loadUser();
  }, [router]);

  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    window.localStorage.setItem(SIDEBAR_KEY, String(next));
  };

  const handleSignOut = () => {
    signOut();
    router.replace("/login");
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="flex min-h-screen w-full">
        <aside
          className={`sticky top-0 flex h-screen flex-col border-r border-slate-200 bg-slate-50 px-3 py-4 transition-all duration-200 ease-in-out ${
            collapsed ? "w-16" : "w-64"
          }`}
        >
          <div className="flex items-center gap-3 px-2 pb-6">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-slate-900 text-white">
              <img
                src="/images/logo.png"
                alt="Logo"
                className="h-full w-full object-cover"
              />
            </div>
            <div className={`${collapsed ? "hidden" : "block"}`}>
              <div className="text-sm font-semibold text-slate-900">
                二进制伽利略的工具站
              </div>
              <div className="text-xs text-slate-500">{pageTitle}</div>
            </div>
          </div>

          <nav className="space-y-6">
            {navGroups.map((group) => (
              <div key={group.title} className="space-y-2">
                <div
                  className={`px-3 text-xs font-semibold uppercase text-slate-500 transition-opacity ${
                    collapsed ? "opacity-0" : "opacity-100"
                  }`}
                >
                  {group.title}
                </div>
                {group.items ? (
                  <div className="space-y-1">
                    {group.items.map((item) => {
                      const active = pathname === item.href;
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.href}
                          type="button"
                          onClick={() => router.push(item.href)}
                          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
                            active
                              ? "bg-white text-slate-900 shadow-sm"
                              : "text-slate-600 hover:bg-white"
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                          <span className={`${collapsed ? "hidden" : "block"}`}>
                            {item.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {group.sections?.map((section) => (
                  <div key={`${group.title}-${section.title}`} className="space-y-1">
                    <div
                      className={`px-3 text-xs font-medium text-slate-400 transition-opacity ${
                        collapsed ? "opacity-0" : "opacity-100"
                      }`}
                    >
                      {section.title}
                    </div>
                    {section.items.map((item) => {
                      const active = pathname === item.href;
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.href}
                          type="button"
                          onClick={() => router.push(item.href)}
                          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
                            active
                              ? "bg-white text-slate-900 shadow-sm"
                              : "text-slate-600 hover:bg-white"
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                          <span className={`${collapsed ? "hidden" : "block"}`}>
                            {item.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </nav>

          <div className="mt-auto border-t border-slate-200 pt-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-white ${
                    collapsed ? "justify-center" : ""
                  }`}
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
                    {(user?.email || "U").slice(0, 2).toUpperCase()}
                  </div>
                  <div className={`${collapsed ? "hidden" : "block"}`}>
                    <div className="text-sm font-medium text-slate-900">
                      {user?.username || "用户"}
                    </div>
                    <div className="text-xs text-slate-500">
                      {user?.email || "未登录"}
                    </div>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  {user?.email || "未登录"}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push("/settings/account")}>
                  系统设置
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleSignOut}>退出登录</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <button
            type="button"
            onClick={toggleSidebar}
            className="absolute left-full top-1/2 -translate-y-1/2 rounded-full border border-slate-200 bg-white p-1 shadow-sm transition hover:bg-slate-50"
            aria-label="Toggle sidebar"
          >
            {collapsed ? (
              <ChevronsRight className="h-4 w-4 text-slate-500" />
            ) : (
              <ChevronsLeft className="h-4 w-4 text-slate-500" />
            )}
          </button>
        </aside>

        <main className="flex-1 bg-white/70 px-8 py-10">{children}</main>
      </div>
    </div>
  );
}
