"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, History, Play, Plus, Settings, Trash2 } from "lucide-react";

import { AuthGuard } from "@/components/AuthGuard";
import { AppShell } from "@/components/AppShell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchBlob, fetchJSON } from "@/lib/api";

type PredictionStatus = "idle" | "running" | "success" | "failed";

type PredictionTask = {
  id: string;
  started_at: string;
  finished_at: string | null;
  hit_count: number;
  task_type: "manual" | "scheduled";
  status: PredictionStatus;
};

type StrategiesResponse = {
  items: string[];
  default_strategy: string | null;
};

type StatusResponse = {
  status: PredictionStatus;
  task: PredictionTask | null;
  strategy: string | null;
  error_message: string | null;
};

type LogResponse = {
  task_id: string;
  content: string;
  truncated: boolean;
  total_bytes: number;
};

type PredictionResult = {
  stock_code: string;
  stock_name: string;
  stock_category: string;
  bowl_stage: string;
  sector: string;
};

type ResultsResponse = {
  task_id: string;
  items: PredictionResult[];
};

type TaskListResponse = {
  total: number;
  page: number;
  page_size: number;
  items: PredictionTask[];
};

type DeleteTasksResponse = {
  deleted_count: number;
  deleted_task_ids: string[];
};

type FilterSettings = {
  exclude_gem: boolean;
  exclude_star_market: boolean;
  exclude_insufficient_listing: boolean;
  exclude_failed_year_trend: boolean;
  exclude_insufficient_kline: boolean;
  exclude_failed_volume: boolean;
  exclude_failed_bowl: boolean;
};

type ScheduleSettings = {
  enabled: boolean;
  hour: number;
  minute: number;
};

type RightView = "latest" | "history" | "history-detail";
type SettingsSection = "filters" | "schedule";

const HISTORY_PAGE_SIZE = 15;
const DEFAULT_FILTER_SETTINGS: FilterSettings = {
  exclude_gem: true,
  exclude_star_market: true,
  exclude_insufficient_listing: true,
  exclude_failed_year_trend: true,
  exclude_insufficient_kline: true,
  exclude_failed_volume: true,
  exclude_failed_bowl: true
};
const DEFAULT_SCHEDULE_SETTINGS: ScheduleSettings = {
  enabled: false,
  hour: 9,
  minute: 0
};
const FILTER_OPTIONS: Array<{
  key: keyof FilterSettings;
  label: string;
}> = [
  { key: "exclude_gem", label: "排除创业板" },
  { key: "exclude_star_market", label: "排除科创板" },
  { key: "exclude_insufficient_listing", label: "排除上市时间不足/缺失" },
  { key: "exclude_failed_year_trend", label: "排除一年趋势不通过" },
  { key: "exclude_insufficient_kline", label: "排除 K 线数据不足" },
  { key: "exclude_failed_volume", label: "排除成交量不通过" },
  { key: "exclude_failed_bowl", label: "排除碗型不通过" }
];

const STATUS_LABELS: Record<PredictionStatus, string> = {
  idle: "等待执行",
  running: "运行中",
  success: "执行完成",
  failed: "执行失败"
};

const TASK_TYPE_LABELS: Record<PredictionTask["task_type"], string> = {
  manual: "手动执行",
  scheduled: "定时执行"
};

const TASK_STATUS_STYLES: Record<PredictionStatus, string> = {
  idle: "text-slate-500",
  running: "text-amber-600",
  success: "text-emerald-600",
  failed: "text-rose-600"
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

export default function InvestmentPredictionPage() {
  const terminalRef = useRef<HTMLPreElement | null>(null);
  const [strategies, setStrategies] = useState<string[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState("");
  const [statusData, setStatusData] = useState<StatusResponse>({
    status: "idle",
    task: null,
    strategy: null,
    error_message: null
  });
  const [logContent, setLogContent] = useState("");
  const [results, setResults] = useState<PredictionResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rightView, setRightView] = useState<RightView>("history");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyData, setHistoryData] = useState<TaskListResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedHistoryTask, setSelectedHistoryTask] =
    useState<PredictionTask | null>(null);
  const [historyResults, setHistoryResults] = useState<PredictionResult[]>([]);
  const [historyDetailLoading, setHistoryDetailLoading] = useState(false);
  const [exportingHistoryReport, setExportingHistoryReport] = useState(false);
  const [historySelectionMode, setHistorySelectionMode] = useState(false);
  const [selectedHistoryTaskIds, setSelectedHistoryTaskIds] = useState<Set<string>>(
    new Set()
  );
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingHistory, setDeletingHistory] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("filters");
  const [filterSettings, setFilterSettings] = useState<FilterSettings>(
    DEFAULT_FILTER_SETTINGS
  );
  const [draftFilterSettings, setDraftFilterSettings] =
    useState<FilterSettings>(DEFAULT_FILTER_SETTINGS);
  const [scheduleSettings, setScheduleSettings] = useState<ScheduleSettings>(
    DEFAULT_SCHEDULE_SETTINGS
  );
  const [draftScheduleSettings, setDraftScheduleSettings] =
    useState<ScheduleSettings>(DEFAULT_SCHEDULE_SETTINGS);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const previousStatusRef = useRef<PredictionStatus>("idle");

  const historyTotalPages = useMemo(() => {
    const total = historyData?.total ?? 0;
    return Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  }, [historyData?.total]);

  const loadHistory = useCallback(async (targetPage: number, silent = false) => {
    if (!silent) setHistoryLoading(true);
    try {
      const data = await fetchJSON<TaskListResponse>(
        `/tools/investment-prediction/tasks?page=${targetPage}&page_size=${HISTORY_PAGE_SIZE}`
      );
      setHistoryData(data);
      setHistoryPage(targetPage);
      return data;
    } finally {
      if (!silent) setHistoryLoading(false);
    }
  }, []);

  const loadHistoryDetail = useCallback(async (task: PredictionTask) => {
    setSelectedHistoryTask(task);
    setHistoryResults([]);
    setHistoryDetailLoading(true);
    setRightView("history-detail");
    try {
      const data = await fetchJSON<ResultsResponse>(
        `/tools/investment-prediction/tasks/${task.id}/results`
      );
      setHistoryResults(data.items);
    } catch (err) {
      setRightView("history");
      setSelectedHistoryTask(null);
      setError(err instanceof Error ? err.message : "历史预测详情加载失败");
    } finally {
      setHistoryDetailLoading(false);
    }
  }, []);

  const loadTaskContent = useCallback(
    async (taskId: string, includeResults: boolean) => {
      const requests: [
        Promise<LogResponse>,
        Promise<ResultsResponse> | null
      ] = [
        fetchJSON<LogResponse>(
          `/tools/investment-prediction/tasks/${taskId}/log`
        ),
        includeResults
          ? fetchJSON<ResultsResponse>(
              `/tools/investment-prediction/tasks/${taskId}/results`
            )
          : null
      ];
      const [log, resultData] = await Promise.all([
        requests[0],
        requests[1] ?? Promise.resolve(null)
      ]);
      setLogContent(log.content);
      if (resultData) {
        setResults(resultData.items);
      }
    },
    []
  );

  const refreshStatus = useCallback(async () => {
    const status = await fetchJSON<StatusResponse>(
      "/tools/investment-prediction/status"
    );
    setStatusData(status);
    if (status.task) {
      await loadTaskContent(status.task.id, status.status !== "running");
    } else {
      setLogContent("");
      setResults([]);
    }
    return status;
  }, [loadTaskContent]);

  useEffect(() => {
    const initialize = async () => {
      setLoading(true);
      setError(null);
      try {
        const strategyData = await fetchJSON<StrategiesResponse>(
          "/tools/investment-prediction/strategies"
        );
        setStrategies(strategyData.items);
        setSelectedStrategy(strategyData.default_strategy ?? strategyData.items[0] ?? "");
        const [schedule] = await Promise.all([
          fetchJSON<ScheduleSettings>("/tools/investment-prediction/schedule").catch(
            () => DEFAULT_SCHEDULE_SETTINGS
          ),
          refreshStatus(),
          loadHistory(1)
        ]);
        setScheduleSettings(schedule);
        setDraftScheduleSettings(schedule);
      } catch (err) {
        setError(err instanceof Error ? err.message : "页面加载失败");
      } finally {
        setLoading(false);
      }
    };
    initialize();
  }, [refreshStatus]);

  useEffect(() => {
    if (statusData.status !== "running") return;
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      try {
        await refreshStatus();
        if (rightView === "history") {
          await loadHistory(historyPage, true);
        }
        if (!cancelled) setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "任务状态刷新失败");
        }
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(poll, 1000);
        }
      }
    };
    timer = window.setTimeout(poll, 1000);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [historyPage, loadHistory, refreshStatus, rightView, statusData.status]);

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    const historyTask = selectedHistoryTask;
    const activeTask = statusData.task;
    previousStatusRef.current = statusData.status;
    if (previousStatus !== "running" || statusData.status === "running") return;

    if (rightView === "history") {
      loadHistory(historyPage, true).catch((err) => {
        setError(err instanceof Error ? err.message : "历史任务刷新失败");
      });
    } else if (
      rightView === "history-detail" &&
      historyTask &&
      activeTask &&
      historyTask.id === activeTask.id
    ) {
      loadHistoryDetail({
        ...historyTask,
        finished_at: activeTask.finished_at,
        hit_count: activeTask.hit_count
      });
    }
  }, [
    historyPage,
    loadHistory,
    loadHistoryDetail,
    rightView,
    selectedHistoryTask,
    statusData.status,
    statusData.task
  ]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) {
      terminal.scrollTop = terminal.scrollHeight;
    }
  }, [logContent]);

  const handleRun = async () => {
    if (!selectedStrategy || statusData.status === "running") return;
    setStarting(true);
    setError(null);
    setRightView("latest");
    setHistorySelectionMode(false);
    setSelectedHistoryTaskIds(new Set());
    setResults([]);
    setLogContent("正在启动筛选任务...");
    try {
      await fetchJSON<{ ok: boolean; task_id: string; message: string }>(
        "/tools/investment-prediction/run",
        {
          method: "POST",
          json: {
            strategy: selectedStrategy,
            filters: filterSettings
          }
        }
      );
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "筛选任务启动失败");
      try {
        await refreshStatus();
      } catch {
        // 保留原始启动错误，避免后续刷新错误覆盖更有用的信息。
      }
    } finally {
      setStarting(false);
    }
  };

  const handleHistoryToggle = async () => {
    setError(null);
    if (rightView !== "latest") {
      setRightView("latest");
      setSelectedHistoryTask(null);
      setHistorySelectionMode(false);
      setSelectedHistoryTaskIds(new Set());
      setLogContent("");
      setResults([]);
      setStatusData((current) => ({
        ...current,
        task: current.task
          ? {
              ...current.task,
              hit_count: 0
            }
          : null,
        error_message: null
      }));
      return;
    }
    setRightView("history");
    try {
      await loadHistory(historyPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "历史任务加载失败");
    }
  };

  const toggleHistoryTaskSelection = (taskId: string) => {
    if (running && taskId === statusData.task?.id) return;
    setSelectedHistoryTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const handleHistoryTrash = () => {
    if (!historySelectionMode) {
      setHistorySelectionMode(true);
      setSelectedHistoryTaskIds(new Set());
      return;
    }
    if (selectedHistoryTaskIds.size === 0) {
      setHistorySelectionMode(false);
      return;
    }
    setDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    const taskIds = Array.from(selectedHistoryTaskIds);
    if (taskIds.length === 0 || deletingHistory) return;

    setDeletingHistory(true);
    setError(null);
    try {
      const response = await fetchJSON<DeleteTasksResponse>(
        "/tools/investment-prediction/tasks",
        {
          method: "DELETE",
          json: { task_ids: taskIds }
        }
      );
      setDeleteConfirmOpen(false);
      setHistorySelectionMode(false);
      setSelectedHistoryTaskIds(new Set());

      const refreshedHistory = await loadHistory(historyPage);
      if (refreshedHistory.items.length === 0 && historyPage > 1) {
        await loadHistory(historyPage - 1);
      }

      if (
        statusData.task &&
        response.deleted_task_ids.includes(statusData.task.id)
      ) {
        await refreshStatus();
      }
    } catch (err) {
      setDeleteConfirmOpen(false);
      setError(err instanceof Error ? err.message : "历史预测删除失败");
    } finally {
      setDeletingHistory(false);
    }
  };

  const handleHistoryPrev = async () => {
    const targetPage = Math.max(1, historyPage - 1);
    try {
      await loadHistory(targetPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "历史任务加载失败");
    }
  };

  const handleHistoryNext = async () => {
    const targetPage = Math.min(historyTotalPages, historyPage + 1);
    try {
      await loadHistory(targetPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "历史任务加载失败");
    }
  };

  const handleExportReport = async (task: PredictionTask | null) => {
    if (!task || exportingHistoryReport) return;

    setExportingHistoryReport(true);
    setError(null);
    try {
      const report = await fetchBlob(
        `/tools/investment-prediction/tasks/${task.id}/report`
      );
      const downloadUrl = URL.createObjectURL(report);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `investment_prediction_${task.id}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "报告导出失败");
    } finally {
      setExportingHistoryReport(false);
    }
  };

  const handleSaveSchedule = async () => {
    setSavingSchedule(true);
    setError(null);
    try {
      const saved = await fetchJSON<ScheduleSettings>(
        "/tools/investment-prediction/schedule",
        {
          method: "PUT",
          json: draftScheduleSettings
        }
      );
      setScheduleSettings(saved);
      setDraftScheduleSettings(saved);
      setSettingsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "定时设置保存失败");
    } finally {
      setSavingSchedule(false);
    }
  };

  const running = statusData.status === "running";

  return (
    <AuthGuard>
      <AppShell>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">投资走势预测</h1>
          <p className="text-sm text-slate-500">
            选择碗形策略，筛选符合走势特征的 A 股标的。
          </p>
        </div>

        <Card className="bg-white/95">
          <CardHeader className="pb-4">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
              <div>
                <CardTitle>碗形预测</CardTitle>
                <CardDescription>
                  左侧实时显示执行日志，右侧展示最近一次任务的命中结果。
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={selectedStrategy}
                  onValueChange={setSelectedStrategy}
                  disabled={loading || running || starting || strategies.length === 0}
                >
                  <SelectTrigger className="w-[220px]" aria-label="选择预测策略">
                    <SelectValue placeholder="选择策略" />
                  </SelectTrigger>
                  <SelectContent>
                    {strategies.map((strategy) => (
                      <SelectItem key={strategy} value={strategy}>
                        {strategy}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleRun}
                  disabled={loading || running || starting || !selectedStrategy}
                >
                  <Play className="mr-2 h-4 w-4" />
                  {starting ? "启动中..." : running ? "执行中..." : "执行"}
                </Button>
                <Button
                  variant={rightView === "latest" ? "outline" : "default"}
                  onClick={handleHistoryToggle}
                  disabled={loading || starting || historyLoading}
                >
                  {rightView === "latest" ? (
                    <History className="mr-2 h-4 w-4" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  {rightView === "latest" ? "历史预测" : "新增预测"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDraftFilterSettings({ ...filterSettings });
                    setDraftScheduleSettings({ ...scheduleSettings });
                    setSettingsSection("filters");
                    setSettingsOpen(true);
                  }}
                  disabled={loading || running || starting}
                  aria-label="预测筛选设置"
                  title="预测筛选设置"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {error ? (
              <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
                {error}
              </div>
            ) : null}

            <div className="flex min-h-[600px] flex-col gap-6 xl:h-[calc(100vh-260px)] xl:flex-row">
              <section className="flex min-h-[420px] basis-2/5 flex-col rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 shadow-sm">
                <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                  <span>状态：{STATUS_LABELS[statusData.status]}</span>
                  <span>策略：{statusData.strategy || selectedStrategy || "—"}</span>
                  <span>开始：{formatDateTime(statusData.task?.started_at)}</span>
                  <span>结束：{formatDateTime(statusData.task?.finished_at)}</span>
                </div>
                <pre
                  ref={terminalRef}
                  className="h-full min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950/95 p-4 font-mono text-xs leading-5 text-slate-100 shadow-inner"
                >
                  {loading
                    ? "正在读取任务信息..."
                    : logContent ||
                      statusData.error_message ||
                      "请选择策略并点击“执行”，运行日志将在这里实时显示。"}
                </pre>
              </section>

              <section className="flex min-h-[420px] basis-3/5 flex-col rounded-xl border border-slate-200 bg-gradient-to-b from-emerald-50 to-white p-4 shadow-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium text-slate-800">
                      {rightView === "latest"
                        ? "筛选结果"
                        : rightView === "history"
                          ? "历史预测"
                          : "历史预测详情"}
                    </div>
                    <div className="text-xs text-slate-500">
                      {rightView === "latest"
                        ? running
                          ? "任务运行中，完成后自动更新"
                          : `命中 ${statusData.task?.hit_count ?? results.length} 只股票`
                        : rightView === "history"
                          ? `共 ${historyData?.total ?? 0} 次预测任务`
                          : selectedHistoryTask
                            ? `任务 ${selectedHistoryTask.id.slice(0, 8)} · 命中 ${selectedHistoryTask.hit_count} 只股票`
                            : "历史任务详情"}
                    </div>
                  </div>
                  {rightView === "latest" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleExportReport(statusData.task)}
                      disabled={
                        loading ||
                        running ||
                        !statusData.task ||
                        exportingHistoryReport
                      }
                    >
                      <Download className="mr-2 h-4 w-4" />
                      {exportingHistoryReport ? "导出中..." : "导出报告"}
                    </Button>
                  ) : rightView === "history" ? (
                    <div className="flex items-center gap-2">
                      {historySelectionMode ? (
                        <span className="text-xs text-slate-500">
                          已选 {selectedHistoryTaskIds.size} 项
                        </span>
                      ) : null}
                      <Button
                        type="button"
                        variant={historySelectionMode ? "default" : "outline"}
                        size="icon"
                        onClick={handleHistoryTrash}
                        disabled={historyLoading || deletingHistory}
                        className={
                          historySelectionMode
                            ? "bg-rose-600 text-white hover:bg-rose-700"
                            : "text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                        }
                        aria-label={
                          historySelectionMode
                            ? selectedHistoryTaskIds.size > 0
                              ? `删除选中的 ${selectedHistoryTaskIds.size} 个历史预测`
                              : "退出历史预测选择模式"
                            : "选择要删除的历史预测"
                        }
                        title={
                          historySelectionMode
                            ? selectedHistoryTaskIds.size > 0
                              ? "删除已选任务"
                              : "退出选择"
                            : "批量删除历史预测"
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : rightView === "history-detail" ? (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleExportReport(selectedHistoryTask)}
                        disabled={historyDetailLoading || !selectedHistoryTask || exportingHistoryReport}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        {exportingHistoryReport ? "导出中..." : "导出报告"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setRightView("history");
                          setSelectedHistoryTask(null);
                        }}
                      >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        返回历史
                      </Button>
                    </div>
                  ) : null}
                </div>
                {rightView === "history" ? (
                  <>
                    <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {historySelectionMode ? (
                              <TableHead className="w-10">
                                <span className="sr-only">选择</span>
                              </TableHead>
                            ) : null}
                            <TableHead>任务 ID</TableHead>
                            <TableHead>开始时间</TableHead>
                            <TableHead>结束时间</TableHead>
                            <TableHead>任务类型</TableHead>
                            <TableHead>任务执行情况</TableHead>
                            <TableHead className="text-right">命中数量</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {historyLoading ? (
                            <TableRow>
                              <TableCell
                                colSpan={historySelectionMode ? 7 : 6}
                                className="text-center text-slate-500"
                              >
                                历史任务加载中...
                              </TableCell>
                            </TableRow>
                          ) : (historyData?.items.length ?? 0) === 0 ? (
                            <TableRow>
                              <TableCell
                                colSpan={historySelectionMode ? 7 : 6}
                                className="h-40 text-center text-slate-500"
                              >
                                暂无历史预测
                              </TableCell>
                            </TableRow>
                          ) : (
                            historyData?.items.map((item) => (
                              <TableRow
                                key={item.id}
                                className={
                                  historySelectionMode
                                    ? selectedHistoryTaskIds.has(item.id)
                                      ? "cursor-pointer bg-rose-50 hover:bg-rose-100"
                                      : "cursor-pointer hover:bg-slate-50"
                                    : "cursor-pointer hover:bg-emerald-50"
                                }
                                onClick={() => {
                                  if (historySelectionMode) {
                                    toggleHistoryTaskSelection(item.id);
                                  } else {
                                    void loadHistoryDetail(item);
                                  }
                                }}
                              >
                                {historySelectionMode ? (
                                  <TableCell>
                                    <input
                                      type="checkbox"
                                      checked={selectedHistoryTaskIds.has(item.id)}
                                      disabled={running && item.id === statusData.task?.id}
                                      onClick={(event) => event.stopPropagation()}
                                      onChange={() => toggleHistoryTaskSelection(item.id)}
                                      className="h-4 w-4 rounded border-slate-300 accent-rose-600"
                                      aria-label={`选择任务 ${item.id.slice(0, 8)}`}
                                      title={
                                        running && item.id === statusData.task?.id
                                          ? "运行中的任务不能删除"
                                          : undefined
                                      }
                                    />
                                  </TableCell>
                                ) : null}
                                <TableCell
                                  className="font-mono font-medium"
                                  title={item.id}
                                >
                                  {item.id.slice(0, 8)}
                                </TableCell>
                                <TableCell>{formatDateTime(item.started_at)}</TableCell>
                                <TableCell>{formatDateTime(item.finished_at)}</TableCell>
                                <TableCell>{TASK_TYPE_LABELS[item.task_type]}</TableCell>
                                <TableCell className={TASK_STATUS_STYLES[item.status]}>
                                  {STATUS_LABELS[item.status]}
                                </TableCell>
                                <TableCell className="text-right">{item.hit_count}</TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleHistoryPrev}
                        disabled={historyLoading || historyPage <= 1}
                      >
                        上一页
                      </Button>
                      <span className="text-sm text-slate-600">
                        第 {historyPage} / {historyTotalPages} 页
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleHistoryNext}
                        disabled={historyLoading || historyPage >= historyTotalPages}
                      >
                        下一页
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>股票代码</TableHead>
                          <TableHead>股票名称</TableHead>
                          <TableHead>股票分类</TableHead>
                          <TableHead>碗形阶段</TableHead>
                          <TableHead>板块</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(rightView === "latest" ? loading : historyDetailLoading) ? (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center text-slate-500">
                              结果加载中...
                            </TableCell>
                          </TableRow>
                        ) : (rightView === "latest" ? results : historyResults).length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5} className="h-40 text-center text-slate-500">
                              {rightView === "latest" && running
                                ? "正在执行筛选..."
                                : rightView === "history-detail" &&
                                    selectedHistoryTask?.id === statusData.task?.id &&
                                    running
                                  ? "任务运行中，完成后更新"
                                  : "暂无命中结果"}
                            </TableCell>
                          </TableRow>
                        ) : (
                          (rightView === "latest" ? results : historyResults).map((item) => (
                            <TableRow key={`${item.stock_code}-${item.bowl_stage}`}>
                              <TableCell className="font-mono font-medium">
                                {item.stock_code}
                              </TableCell>
                              <TableCell>{item.stock_name}</TableCell>
                              <TableCell>{item.stock_category}</TableCell>
                              <TableCell>
                                <span className="inline-flex rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">
                                  {item.bowl_stage}
                                </span>
                              </TableCell>
                              <TableCell>{item.sector}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </section>
            </div>
          </CardContent>
        </Card>
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="max-w-4xl p-0">
            <div className="flex min-h-[520px]">
              <aside className="w-48 shrink-0 border-r border-slate-200 bg-slate-50 p-4">
                <div className="mb-5 px-3 text-sm font-semibold text-slate-700">设置</div>
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => setSettingsSection("filters")}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                      settingsSection === "filters"
                        ? "bg-slate-900 font-medium text-white"
                        : "text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    预测筛选设置
                  </button>
                  <button
                    type="button"
                    onClick={() => setSettingsSection("schedule")}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                      settingsSection === "schedule"
                        ? "bg-slate-900 font-medium text-white"
                        : "text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    定时设置
                  </button>
                </div>
              </aside>
              <div className="flex min-w-0 flex-1 flex-col p-7">
                {settingsSection === "filters" ? (
                  <>
                    <DialogHeader>
                      <DialogTitle>预测筛选设置</DialogTitle>
                      <DialogDescription>
                        勾选本次预测需要执行的排除条件；取消勾选后，该条件将不再拦截股票。
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                      {FILTER_OPTIONS.map((option) => (
                        <label
                          key={option.key}
                          className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 text-sm text-slate-700 transition hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            checked={draftFilterSettings[option.key]}
                            onChange={(event) => {
                              const checked = event.target.checked;
                              setDraftFilterSettings((current) => ({
                                ...current,
                                [option.key]: checked
                              }));
                            }}
                            className="h-4 w-4 rounded border-slate-300 accent-slate-900"
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                    <div className="mt-auto flex justify-end gap-2 pt-6">
                      <Button type="button" variant="outline" onClick={() => setSettingsOpen(false)}>
                        取消
                      </Button>
                      <Button type="button" onClick={() => {
                        setFilterSettings({ ...draftFilterSettings });
                        setSettingsOpen(false);
                      }}>
                        保存设置
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <DialogHeader>
                      <DialogTitle>定时设置</DialogTitle>
                      <DialogDescription>
                        开启后，服务端会在每天指定的北京时间自动执行默认碗形预测策略。
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-5">
                      <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-4">
                        <div>
                          <div className="font-medium text-slate-800">启用定时执行</div>
                          <div className="mt-1 text-sm text-slate-500">每天执行一次预测程序</div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={draftScheduleSettings.enabled}
                          onClick={() => setDraftScheduleSettings((current) => ({
                            ...current,
                            enabled: !current.enabled
                          }))}
                          className={`relative h-7 w-12 rounded-full transition ${
                            draftScheduleSettings.enabled ? "bg-slate-900" : "bg-slate-300"
                          }`}
                        >
                          <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${
                            draftScheduleSettings.enabled ? "left-6" : "left-1"
                          }`} />
                        </button>
                      </div>
                      <label className="block rounded-lg border border-slate-200 px-4 py-4">
                        <span className="block font-medium text-slate-800">执行时间</span>
                        <span className="mt-1 block text-sm text-slate-500">每天在此时间开始运行。</span>
                        <input
                          type="time"
                          value={`${String(draftScheduleSettings.hour).padStart(2, "0")}:${String(draftScheduleSettings.minute).padStart(2, "0")}`}
                          onChange={(event) => {
                            const [hour, minute] = event.target.value.split(":").map(Number);
                            setDraftScheduleSettings((current) => ({ ...current, hour, minute }));
                          }}
                          className="mt-3 h-10 rounded-md border border-slate-200 px-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900"
                        />
                      </label>
                    </div>
                    <div className="mt-auto flex justify-end gap-2 pt-6">
                      <Button type="button" variant="outline" onClick={() => setSettingsOpen(false)} disabled={savingSchedule}>
                        取消
                      </Button>
                      <Button type="button" onClick={handleSaveSchedule} disabled={savingSchedule}>
                        {savingSchedule ? "保存中..." : "保存设置"}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
        <AlertDialog
          open={deleteConfirmOpen}
          onOpenChange={(open) => {
            if (!deletingHistory) setDeleteConfirmOpen(open);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除历史预测？</AlertDialogTitle>
              <AlertDialogDescription>
                将永久删除选中的 {selectedHistoryTaskIds.size} 个任务，以及对应的预测明细、
                日志和 Excel 文件。此操作无法撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletingHistory}>取消</AlertDialogCancel>
              <AlertDialogAction
                disabled={deletingHistory}
                className="bg-rose-600 hover:bg-rose-700"
                onClick={(event) => {
                  event.preventDefault();
                  void handleConfirmDelete();
                }}
              >
                {deletingHistory ? "删除中..." : "确认删除"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AppShell>
    </AuthGuard>
  );
}
