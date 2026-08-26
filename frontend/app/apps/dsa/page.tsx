"use client";

import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { AuthGuard } from "@/components/AuthGuard";
import { fetchJSON } from "@/lib/api";

type DsaSessionResponse = { launch_url: string };

export default function DsaPage() {
  const [launchUrl, setLaunchUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchJSON<DsaSessionResponse>("/tools/dsa/session", { method: "POST" })
      .then((data) => {
        if (active) setLaunchUrl(data.launch_url);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "DSA 系统无法启动");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <AuthGuard>
      <AppShell contentClassName="overflow-hidden !p-0" shellClassName="h-screen overflow-hidden">
        <main className="h-screen min-h-[620px]">
          {error ? (
            <div className="flex h-full items-center justify-center bg-rose-50 p-5 text-sm text-rose-700">
              {error}
            </div>
          ) : launchUrl ? (
            <iframe
              title="DSA系统"
              src={launchUrl}
              className="block h-full w-full border-0 bg-white"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-white text-sm text-slate-500">
              正在安全连接 DSA 系统…
            </div>
          )}
        </main>
      </AppShell>
    </AuthGuard>
  );
}
