"use client";

import { useState } from "react";

import { AuthGuard } from "@/components/AuthGuard";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchJSON } from "@/lib/api";

export default function PasswordSettingsPage() {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setStatus(null);

    try {
      await fetchJSON<{ ok: boolean }>("/settings/password", {
        method: "PUT",
        json: {
          old_password: oldPassword,
          new_password: newPassword,
          new_password_confirm: confirmPassword
        }
      });
      setStatus("已修改");
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "修改失败";
      setStatus(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthGuard>
      <AppShell>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">密码修改</h1>
          <p className="text-sm text-slate-500">定期更新密码以保证账户安全。</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>密码修改</CardTitle>
            <CardDescription>定期更新密码以保证账户安全。</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="old_password">当前密码</Label>
                <Input
                  id="old_password"
                  type="password"
                  value={oldPassword}
                  onChange={(event) => setOldPassword(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new_password">新密码</Label>
                <Input
                  id="new_password"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm_password">确认新密码</Label>
                <Input
                  id="confirm_password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </div>
              {status ? <p className="text-sm text-slate-600">{status}</p> : null}
              <Button type="submit" disabled={loading}>
                {loading ? "提交中..." : "保存"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </AppShell>
    </AuthGuard>
  );
}
