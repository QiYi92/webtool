"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Workflow, Settings, Trash2 } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { AuthGuard } from "@/components/AuthGuard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchJSON } from "@/lib/api";

type RoleUser = {
  role_group: string;
};

type WorkflowItem = {
  id: string;
  name: string;
  url: string;
  visible_role_groups: string[];
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

type CreateWorkflowPayload = {
  name: string;
  url: string;
  visible_role_groups: string[];
  sort_order: number;
};

type UpdateWorkflowPayload = {
  name?: string;
  url?: string;
  visible_role_groups?: string[];
  sort_order?: number;
  is_active?: boolean;
};

const emptyForm = {
  name: "",
  url: "",
  visibleRoleGroups: ["admin"],
  sortOrder: "0",
  isActive: true
};

const ROLE_GROUP_OPTIONS = ["admin", "user", "temp"];

export default function AIWorkflowPage() {
  const router = useRouter();
  const [roleGroup, setRoleGroup] = useState<string>("");
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formState, setFormState] = useState(emptyForm);
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowItem | null>(null);

  const isAdmin = roleGroup === "admin";

  const sortedWorkflows = useMemo(
    () =>
      [...workflows].sort((a, b) => {
        if (a.sort_order !== b.sort_order) {
          return a.sort_order - b.sort_order;
        }
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }),
    [workflows]
  );

  const loadData = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [me, list] = await Promise.all([
        fetchJSON<RoleUser>("/me"),
        fetchJSON<WorkflowItem[]>("/tools/ai-workflows")
      ]);
      setRoleGroup(me.role_group);
      setWorkflows(list);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "加载失败";
      setMessage(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!toastMessage) {
      return;
    }
    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 2200);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const openCreate = () => {
    setFormState(emptyForm);
    setShowCreate(true);
  };

  const openSettings = (workflow: WorkflowItem) => {
    setActiveWorkflow(workflow);
    setFormState({
      name: workflow.name,
      url: workflow.url,
      visibleRoleGroups: workflow.visible_role_groups,
      sortOrder: String(workflow.sort_order ?? 0),
      isActive: workflow.is_active
    });
    setShowSettings(true);
  };

  const openDeleteConfirm = (workflow: WorkflowItem) => {
    setActiveWorkflow(workflow);
    setShowDeleteConfirm(true);
  };

  const handleCreate = async () => {
    setMessage(null);
    const visibleRoleGroups = formState.visibleRoleGroups;
    const sortOrder = Number.parseInt(formState.sortOrder, 10);

    if (!formState.name.trim()) {
      setMessage("工作流名称不能为空");
      return;
    }
    if (!formState.url.trim().toLowerCase().startsWith("http")) {
      setMessage("工作流地址必须以 http 开头");
      return;
    }
    if (visibleRoleGroups.length === 0) {
      setMessage("可见权限组至少填写 1 个");
      return;
    }

    setSubmitting(true);
    try {
      const payload: CreateWorkflowPayload = {
        name: formState.name.trim(),
        url: formState.url.trim(),
        visible_role_groups: visibleRoleGroups,
        sort_order: Number.isNaN(sortOrder) ? 0 : sortOrder
      };
      await fetchJSON<WorkflowItem>("/tools/ai-workflows", {
        method: "POST",
        json: payload
      });
      setShowCreate(false);
      setToastMessage("工作流窗口创建成功");
      await loadData();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "创建失败";
      setMessage(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async () => {
    if (!activeWorkflow) {
      return;
    }
    setMessage(null);
    const visibleRoleGroups = formState.visibleRoleGroups;
    const sortOrder = Number.parseInt(formState.sortOrder, 10);

    if (!formState.name.trim()) {
      setMessage("工作流名称不能为空");
      return;
    }
    if (!formState.url.trim().toLowerCase().startsWith("http")) {
      setMessage("工作流地址必须以 http 开头");
      return;
    }
    if (visibleRoleGroups.length === 0) {
      setMessage("可见权限组至少填写 1 个");
      return;
    }

    setSubmitting(true);
    try {
      const payload: UpdateWorkflowPayload = {
        name: formState.name.trim(),
        url: formState.url.trim(),
        visible_role_groups: visibleRoleGroups,
        sort_order: Number.isNaN(sortOrder) ? 0 : sortOrder,
        is_active: formState.isActive
      };
      await fetchJSON<WorkflowItem>(`/tools/ai-workflows/${activeWorkflow.id}`, {
        method: "PATCH",
        json: payload
      });
      setShowSettings(false);
      setToastMessage("工作流设置已保存");
      await loadData();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "保存失败";
      setMessage(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!activeWorkflow) {
      return;
    }
    setDeleting(true);
    setMessage(null);
    try {
      await fetchJSON<{ ok: boolean }>(`/tools/ai-workflows/${activeWorkflow.id}`, {
        method: "DELETE"
      });
      setShowDeleteConfirm(false);
      setToastMessage("工作流已删除");
      await loadData();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "删除失败";
      setMessage(errorMessage);
    } finally {
      setDeleting(false);
    }
  };

  const toggleRoleGroup = (group: string, checked: boolean) => {
    setFormState((prev) => {
      const next = checked
        ? [...new Set([...prev.visibleRoleGroups, group])]
        : prev.visibleRoleGroups.filter((item) => item !== group);
      return { ...prev, visibleRoleGroups: next };
    });
  };

  return (
    <AuthGuard>
      <AppShell>
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">AI工作流</h1>
            <p className="text-sm text-slate-500">选择一个工作流窗口并在嵌入页面中使用。</p>
          </div>
          {isAdmin ? (
            <Button className="gap-2" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              新建工作流窗口
            </Button>
          ) : null}
        </div>

        {toastMessage ? (
          <div className="fixed right-6 top-6 z-50 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700 shadow-sm">
            {toastMessage}
          </div>
        ) : null}

        {message ? (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
            {message}
          </div>
        ) : null}

        {loading ? (
          <div className="text-sm text-slate-500">正在加载工作流...</div>
        ) : sortedWorkflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center">
            <Workflow className="h-8 w-8 text-slate-400" />
            <p className="mt-2 text-sm text-slate-500">当前没有可用工作流窗口</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
            {sortedWorkflows.map((workflow) => (
                <Card
                  key={workflow.id}
                  className="relative cursor-pointer border-slate-200 bg-white transition hover:border-slate-300 hover:shadow-sm"
                  onClick={() => router.push(`/apps/ai-workflow/${workflow.id}`)}
                >
                <CardHeader className="pb-2">
                  <CardTitle className="line-clamp-2 text-lg">{workflow.name}</CardTitle>
                  <CardDescription className="line-clamp-1 text-xs">
                    {workflow.url}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  {isAdmin ? (
                    <div className="flex flex-wrap gap-2">
                      {workflow.visible_role_groups.map((group) => (
                        <span
                          key={`${workflow.id}-${group}`}
                          className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600"
                        >
                          {group}
                        </span>
                      ))}
                      {!workflow.is_active ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                          已禁用
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400">点击进入</div>
                  )}
                </CardContent>
                {isAdmin ? (
                  <div className="absolute bottom-3 right-3 flex items-center gap-1">
                    <button
                      type="button"
                      className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-600 shadow-sm transition hover:bg-slate-50"
                      onClick={(event) => {
                        event.stopPropagation();
                        openSettings(workflow);
                      }}
                      title="设置"
                      aria-label="设置"
                    >
                      <Settings className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-slate-200 bg-white p-1.5 text-rose-600 shadow-sm transition hover:bg-rose-50"
                      onClick={(event) => {
                        event.stopPropagation();
                        openDeleteConfirm(workflow);
                      }}
                      title="删除"
                      aria-label="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        )}

        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新建工作流窗口</DialogTitle>
              <DialogDescription>填写基础信息即可创建一个可访问窗口。</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="workflow-name">工作流名称</Label>
                <Input
                  id="workflow-name"
                  value={formState.name}
                  onChange={(event) =>
                    setFormState({ ...formState, name: event.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="workflow-url">工作流地址</Label>
                <Input
                  id="workflow-url"
                  value={formState.url}
                  onChange={(event) =>
                    setFormState({ ...formState, url: event.target.value })
                  }
                  placeholder="https://..."
                />
              </div>
              <div className="space-y-2">
                <Label>可见权限组</Label>
                <div className="grid grid-cols-2 gap-2">
                  {ROLE_GROUP_OPTIONS.map((group) => (
                    <label
                      key={`create-${group}`}
                      className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={formState.visibleRoleGroups.includes(group)}
                        onChange={(event) => toggleRoleGroup(group, event.target.checked)}
                      />
                      {group}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="workflow-sort-order">排序（sort_order）</Label>
                <Input
                  id="workflow-sort-order"
                  type="number"
                  value={formState.sortOrder}
                  onChange={(event) =>
                    setFormState({ ...formState, sortOrder: event.target.value })
                  }
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowCreate(false)}>
                  取消
                </Button>
                <Button onClick={handleCreate} disabled={submitting}>
                  {submitting ? "提交中..." : "创建"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={showSettings} onOpenChange={setShowSettings}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>工作流设置</DialogTitle>
              <DialogDescription>修改后立即生效。</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-workflow-name">工作流名称</Label>
                <Input
                  id="edit-workflow-name"
                  value={formState.name}
                  onChange={(event) =>
                    setFormState({ ...formState, name: event.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-workflow-url">工作流地址</Label>
                <Input
                  id="edit-workflow-url"
                  value={formState.url}
                  onChange={(event) =>
                    setFormState({ ...formState, url: event.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>可见权限组</Label>
                <div className="grid grid-cols-2 gap-2">
                  {ROLE_GROUP_OPTIONS.map((group) => (
                    <label
                      key={`edit-${group}`}
                      className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={formState.visibleRoleGroups.includes(group)}
                        onChange={(event) => toggleRoleGroup(group, event.target.checked)}
                      />
                      {group}
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-workflow-sort-order">排序（sort_order）</Label>
                <Input
                  id="edit-workflow-sort-order"
                  type="number"
                  value={formState.sortOrder}
                  onChange={(event) =>
                    setFormState({ ...formState, sortOrder: event.target.value })
                  }
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={formState.isActive}
                  onChange={(event) =>
                    setFormState({
                      ...formState,
                      isActive: event.target.checked
                    })
                  }
                />
                启用该工作流
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowSettings(false)}>
                  取消
                </Button>
                <Button onClick={handleUpdate} disabled={submitting}>
                  {submitting ? "保存中..." : "保存"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除工作流？</AlertDialogTitle>
              <AlertDialogDescription>
                删除后不可恢复。请确认你要删除该工作流窗口。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                className="bg-rose-600 hover:bg-rose-700"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "删除中..." : "同意删除"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AppShell>
    </AuthGuard>
  );
}
