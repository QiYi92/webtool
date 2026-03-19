"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Eye, EyeOff, RotateCw } from "lucide-react";

import { fetchJSON } from "@/lib/api";
import { isAuthed, setToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type LoginResponse = {
  access_token: string;
  token_type: string;
  user: {
    id: string;
    username: string;
    email: string;
    role_group: string;
  };
};

type CaptchaResponse = {
  captcha_id: string;
  image_data: string;
  expires_in_seconds: number;
};

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [captchaId, setCaptchaId] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [captchaImage, setCaptchaImage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const loadCaptcha = async () => {
    setCaptchaLoading(true);
    try {
      const data = await fetchJSON<CaptchaResponse>("/auth/captcha");
      setCaptchaId(data.captcha_id);
      setCaptchaImage(data.image_data);
      setCaptchaAnswer("");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "验证码加载失败";
      setError(message);
    } finally {
      setCaptchaLoading(false);
    }
  };

  useEffect(() => {
    // 已登录用户访问登录页时直接跳转首页。
    if (isAuthed()) {
      router.replace("/");
      return;
    }
    void loadCaptcha();
  }, [router]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const data = await fetchJSON<LoginResponse>("/auth/login", {
        method: "POST",
        json: {
          identifier,
          password,
          captcha_id: captchaId,
          captcha_answer: captchaAnswer
        }
      });
      setToken(data.access_token);
      router.replace("/");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "账号或密码不正确";
      setError(message);
      setLoading(false);
      await loadCaptcha();
      return;
    }
    setLoading(false);
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-50 flex items-center justify-center px-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>登录</CardTitle>
          <CardDescription>使用账号或邮箱进入系统管理台</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="identifier">账号或邮箱</Label>
              <Input
                id="identifier"
                name="identifier"
                type="text"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="请输入账号或邮箱"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="请输入密码"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="captcha">验证码（计算题）</Label>
              <div className="flex w-full items-stretch gap-2">
                <div className="h-10 w-25 shrink-0 overflow-hidden rounded-md border border-input bg-white">
                  {captchaImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={captchaImage} alt="验证码" className="h-full w-full object-contain" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-slate-400">
                      加载中...
                    </div>
                  )}
                </div>
                <Input
                  id="captcha"
                  name="captcha"
                  type="text"
                  value={captchaAnswer}
                  onChange={(event) => setCaptchaAnswer(event.target.value)}
                  placeholder="请输入计算结果"
                  required
                  className="h-10 min-w-0 flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void loadCaptcha()}
                  disabled={captchaLoading || loading}
                  className="h-10 w-10 p-0"
                  aria-label="刷新验证码"
                  title="刷新验证码"
                >
                  <RotateCw className={`h-4 w-4 ${captchaLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>
              <p className="text-xs text-slate-500">
                看不清可点击刷新，验证码 5 分钟内有效。
              </p>
            </div>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <Button
              type="submit"
              className="w-full"
              disabled={loading || captchaLoading || !captchaId}
            >
              {loading ? "正在登录..." : "登录"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
