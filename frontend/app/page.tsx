"use client";

import { AuthGuard } from "@/components/AuthGuard";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToolsGrid } from "@/components/tools/ToolsGrid";

export default function HomePage() {
  return (
    <AuthGuard>
      <AppShell>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">主页</h1>
          <p className="text-sm text-slate-500">欢迎进入 galileocat-webtool。</p>
        </div>
        <Card className="bg-white">
          <CardHeader>
            <CardTitle>主页</CardTitle>
            <CardDescription>欢迎进入 galileocat-webtool。</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600">
              这里是主页内容区域，后续将接入你的工具模块与仪表盘信息。
            </p>
          </CardContent>
        </Card>
        <div className="mt-8">
          <ToolsGrid />
        </div>
      </AppShell>
    </AuthGuard>
  );
}
