"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { AuthGuard } from "@/components/AuthGuard";
import { Button } from "@/components/ui/button";
import { fetchJSON } from "@/lib/api";

type WorkflowItem = {
  id: string;
  name: string;
  url: string;
  visible_role_groups: string[];
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

function buildIframeUrl(url: string, conversationId: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("conversation_id", conversationId);
    return parsed.toString();
  } catch {
    const joiner = url.includes("?") ? "&" : "?";
    return `${url}${joiner}conversation_id=${encodeURIComponent(conversationId)}`;
  }
}

function generateConversationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const template = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  return template.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function AIWorkflowDetailPage({
  params
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const [workflow, setWorkflow] = useState<WorkflowItem | null>(null);
  const [newConversationId, setNewConversationId] = useState<string>(generateConversationId());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadWorkflow = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchJSON<WorkflowItem>(`/tools/ai-workflows/${params.id}`);
        setWorkflow(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : "加载失败";
        setError(message);
      } finally {
        setLoading(false);
      }
    };
    loadWorkflow();
  }, [params.id]);

  useEffect(() => {
    // 每次进入页面都强制生成新会话 ID。
    setNewConversationId(generateConversationId());
  }, [params.id]);

  return (
    <AuthGuard>
      <AppShell>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              {workflow?.name || "AI Workflow"}
            </h1>
            <p className="text-sm text-slate-500">工作流 iframe 嵌入页面</p>
          </div>
          <Button variant="outline" onClick={() => router.push("/apps/ai-workflow")}>
            返回列表
          </Button>
        </div>

        {loading ? (
          <div className="text-sm text-slate-500">正在加载工作流...</div>
        ) : error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
            {error}
          </div>
        ) : workflow ? (
          <div className="flex h-[calc(100vh-180px)] min-h-[700px] overflow-hidden rounded-xl border border-slate-200 bg-white">
            <iframe
              src={buildIframeUrl(workflow.url, newConversationId)}
              className="h-full w-full border-0"
              allow="microphone"
              title={workflow.name}
            />
          </div>
        ) : (
          <div className="text-sm text-slate-500">未找到该工作流</div>
        )}
      </AppShell>
    </AuthGuard>
  );
}
