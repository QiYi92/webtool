"use client";

import { useEffect, useState } from "react";

import { AuthGuard } from "@/components/AuthGuard";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchJSON } from "@/lib/api";

type UserInfo = {
  id: string;
  username: string;
  email: string;
  role_group: string;
};

export default function AccountSettingsPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchJSON<UserInfo>("/me");
        setUsername(data.username);
        setEmail(data.email);
      } catch (error) {
        setStatus("无法加载用户信息");
      }
    };

    load();
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setStatus(null);

    try {
      await fetchJSON<UserInfo>("/settings/account", {
        method: "PUT",
        json: { username, email }
      });
      setStatus("已保存");
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存失败";
      setStatus(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthGuard>
      <AppShell>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">账号信息修改</h1>
          <p className="text-sm text-slate-500">更新你的用户名与邮箱信息。</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>账号信息修改</CardTitle>
            <CardDescription>更新你的用户名与邮箱信息。</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="username">用户名</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">邮箱</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              {status ? <p className="text-sm text-slate-600">{status}</p> : null}
              <Button type="submit" disabled={loading}>
                {loading ? "保存中..." : "保存"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </AppShell>
    </AuthGuard>
  );
}
