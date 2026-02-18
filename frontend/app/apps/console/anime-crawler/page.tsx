"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AuthGuard } from "@/components/AuthGuard";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJSON } from "@/lib/api";

type RunType = "manual" | "scheduled" | "autostart";
type RunStatus = "running" | "success" | "failed";

type CrawlerLogRecord = {
  id: string;
  crawler_name: string;
  run_type: RunType;
  status: RunStatus;
  started_at: string | null;
  finished_at: string | null;
  duration_ms?: number | null;
  command?: string | null;
  summary?: string | null;
  error_message?: string | null;
  log_path: string;
};

type LatestLogResponse = {
  record: CrawlerLogRecord | null;
  content: string;
  truncated: boolean;
  total_bytes: number;
  warning?: string | null;
};

type LogListResponse = {
  total: number;
  page: number;
  page_size: number;
  items: CrawlerLogRecord[];
};

const PAGE_SIZE = 15;

const RUN_TYPE_CN: Record<RunType, string> = {
  manual: "手动爬取",
  scheduled: "定时爬取",
  autostart: "自启爬取"
};

const STATUS_CN: Record<RunStatus, string> = {
  running: "运行中",
  success: "成功",
  failed: "失败"
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hour = String(parsed.getHours()).padStart(2, "0");
  const minute = String(parsed.getMinutes()).padStart(2, "0");
  const second = String(parsed.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

export default function AnimeCrawlerConsolePage() {
  const [latest, setLatest] = useState<LatestLogResponse | null>(null);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [listData, setListData] = useState<LogListResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loadingLatest, setLoadingLatest] = useState(true);
  const [loadingList, setLoadingList] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const totalPages = useMemo(() => {
    const total = listData?.total ?? 0;
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  }, [listData?.total]);

  const loadLatest = useCallback(async () => {
    setLoadingLatest(true);
    try {
      const data = await fetchJSON<LatestLogResponse>(
        "/tools/anime-crawler/logs/latest?crawler_name=anime_guide"
      );
      setLatest(data);
      setSelectedLogId(data.record?.id ?? null);
    } finally {
      setLoadingLatest(false);
    }
  }, []);

  const loadList = useCallback(async (targetPage: number) => {
    setLoadingList(true);
    try {
      const data = await fetchJSON<LogListResponse>(
        `/tools/anime-crawler/logs?crawler_name=anime_guide&page=${targetPage}&page_size=${PAGE_SIZE}`
      );
      setListData(data);
      setSelectedLogId((prev) => prev ?? data.items[0]?.id ?? null);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadLogById = useCallback(async (logId: string) => {
    setLoadingLatest(true);
    setError(null);
    try {
      const data = await fetchJSON<LatestLogResponse>(
        `/tools/anime-crawler/logs/${logId}/tail?crawler_name=anime_guide`
      );
      setLatest(data);
      setSelectedLogId(logId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "读取日志失败";
      setError(message);
    } finally {
      setLoadingLatest(false);
    }
  }, []);

  useEffect(() => {
    const initialize = async () => {
      setError(null);
      try {
        await Promise.all([loadLatest(), loadList(1)]);
      } catch (err) {
        const message = err instanceof Error ? err.message : "加载失败";
        setError(message);
      }
    };
    initialize();
  }, [loadLatest, loadList]);

  useEffect(() => {
    if (page === 1) {
      return;
    }
    const loadByPage = async () => {
      setError(null);
      try {
        await loadList(page);
      } catch (err) {
        const message = err instanceof Error ? err.message : "加载失败";
        setError(message);
      }
    };
    loadByPage();
  }, [page, loadList]);

  const handleRefresh = async () => {
    setError(null);
    try {
      await Promise.all([loadLatest(), loadList(page)]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "刷新失败";
      setError(message);
    }
  };

  const handlePrev = () => {
    setPage((prev) => Math.max(1, prev - 1));
  };

  const handleNext = () => {
    setPage((prev) => Math.min(totalPages, prev + 1));
  };

  const displayRecord = latest?.record;

  return (
    <AuthGuard>
      <AppShell>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">新番爬虫控制台</h1>
          <p className="text-sm text-slate-500">查看最新爬取日志与历史运行记录。</p>
        </div>

        <Card className="bg-white/95">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>日志总览</CardTitle>
                <CardDescription>左侧最新日志内容，右侧历史日志索引。</CardDescription>
              </div>
              <Button onClick={handleRefresh} disabled={loadingLatest || loadingList}>
                刷新
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {error ? (
              <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
                {error}
              </div>
            ) : null}
            <div className="flex h-[calc(100vh-250px)] min-h-[560px] flex-col gap-6 lg:flex-row">
              <section className="flex basis-2/3 flex-col rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 shadow-sm">
                <div className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                  {loadingLatest ? (
                    "最新日志加载中..."
                  ) : displayRecord ? (
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      <span>类型：{RUN_TYPE_CN[displayRecord.run_type]}</span>
                      <span>状态：{STATUS_CN[displayRecord.status]}</span>
                      <span>开始：{formatDateTime(displayRecord.started_at)}</span>
                      <span>结束：{formatDateTime(displayRecord.finished_at)}</span>
                    </div>
                  ) : (
                    "暂无最新日志"
                  )}
                </div>
                <pre className="h-full min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-slate-950/95 p-4 font-mono text-xs leading-5 text-slate-100 whitespace-pre-wrap shadow-inner">
                  {loadingLatest
                    ? "正在读取日志..."
                    : latest?.content || latest?.warning || "暂无日志内容"}
                </pre>
              </section>

              <section className="flex basis-1/3 flex-col rounded-xl border border-slate-200 bg-gradient-to-b from-emerald-50 to-white p-4 shadow-sm">
                <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>序号</TableHead>
                        <TableHead>类型</TableHead>
                        <TableHead>状态</TableHead>
                        <TableHead>结束时间</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loadingList ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-slate-500">
                            列表加载中...
                          </TableCell>
                        </TableRow>
                      ) : (listData?.items.length ?? 0) === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center text-slate-500">
                            暂无记录
                          </TableCell>
                        </TableRow>
                      ) : (
                        listData?.items.map((item, index) => (
                          <TableRow
                            key={item.id}
                            className={`cursor-pointer ${
                              selectedLogId === item.id ? "bg-emerald-100/70" : ""
                            }`}
                            onClick={() => loadLogById(item.id)}
                          >
                            <TableCell>{(page - 1) * PAGE_SIZE + index + 1}</TableCell>
                            <TableCell>{RUN_TYPE_CN[item.run_type]}</TableCell>
                            <TableCell>{STATUS_CN[item.status]}</TableCell>
                            <TableCell>{formatDateTime(item.finished_at)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
                <div className="mt-auto flex items-center justify-between border-t border-slate-200 pt-4">
                  <Button variant="outline" size="sm" onClick={handlePrev} disabled={page <= 1}>
                    上一页
                  </Button>
                  <span className="text-sm text-slate-600">
                    第 {page} / {totalPages} 页
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleNext}
                    disabled={page >= totalPages}
                  >
                    下一页
                  </Button>
                </div>
              </section>
            </div>
          </CardContent>
        </Card>
      </AppShell>
    </AuthGuard>
  );
}
