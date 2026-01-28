"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Plus, Search, Trash2, UserCog } from "lucide-react";

import { AuthGuard } from "@/components/AuthGuard";
import { AppShell } from "@/components/AppShell";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJSON } from "@/lib/api";

type UserItem = {
  id: string;
  username: string;
  email: string;
  role_group: string;
  created_at: string;
  updated_at: string;
};

type UserFormState = {
  username: string;
  email: string;
  password: string;
  passwordConfirm: string;
  role_group: "user" | "temp";
};

const emptyForm: UserFormState = {
  username: "",
  email: "",
  password: "",
  passwordConfirm: "",
  role_group: "user"
};

export default function PermissionsPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [activeUser, setActiveUser] = useState<UserItem | null>(null);
  const [formState, setFormState] = useState<UserFormState>(emptyForm);
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);

  const filteredUsers = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return users;
    }
    return users.filter((user) =>
      user.username.toLowerCase().includes(keyword) ||
      user.email.toLowerCase().includes(keyword)
    );
  }, [query, users]);

  const loadUsers = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const data = await fetchJSON<UserItem[]>("/admin/users");
      setUsers(data);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "加载失败";
      if (msg === "Forbidden") {
        setMessage("仅管理员可访问权限组管理");
        router.replace("/");
        return;
      }
      setMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const openCreate = () => {
    setFormState(emptyForm);
    setShowPassword(false);
    setShowPasswordConfirm(false);
    setShowCreate(true);
  };

  const openEdit = (user: UserItem) => {
    if (user.role_group === "admin") {
      setMessage("管理员账号不可编辑");
      return;
    }
    setActiveUser(user);
    setFormState({
      username: user.username,
      email: user.email,
      password: "",
      passwordConfirm: "",
      role_group: user.role_group === "temp" ? "temp" : "user"
    });
    setShowPassword(false);
    setShowPasswordConfirm(false);
    setShowEdit(true);
  };

  const openDelete = (user: UserItem) => {
    if (user.role_group === "admin") {
      setMessage("管理员账号不可删除");
      return;
    }
    setActiveUser(user);
    setShowDelete(true);
  };

  const handleCreate = async () => {
    setMessage(null);
    if (formState.password.length < 6) {
      setMessage("密码至少 6 位");
      return;
    }
    if (formState.password !== formState.passwordConfirm) {
      setMessage("两次输入的密码不一致");
      return;
    }
    try {
      await fetchJSON<UserItem>("/admin/users", {
        method: "POST",
        json: {
          username: formState.username,
          email: formState.email,
          password: formState.password,
          role_group: formState.role_group
        }
      });
      setShowCreate(false);
      setMessage("创建成功");
      await loadUsers();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "创建失败";
      setMessage(msg);
    }
  };

  const handleUpdate = async () => {
    if (!activeUser) {
      return;
    }
    setMessage(null);
    if (formState.password && formState.password !== formState.passwordConfirm) {
      setMessage("两次输入的密码不一致");
      return;
    }
    try {
      await fetchJSON<UserItem>(`/admin/users/${activeUser.id}`, {
        method: "PUT",
        json: {
          username: formState.username,
          email: formState.email,
          role_group: formState.role_group,
          password: formState.password || null
        }
      });
      setShowEdit(false);
      setMessage("保存成功");
      await loadUsers();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "更新失败";
      setMessage(msg);
    }
  };

  const handleDelete = async () => {
    if (!activeUser) {
      return;
    }
    setMessage(null);
    try {
      await fetchJSON<{ ok: boolean }>(`/admin/users/${activeUser.id}`, {
        method: "DELETE"
      });
      setShowDelete(false);
      setMessage("删除成功");
      await loadUsers();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "删除失败";
      setMessage(msg);
    }
  };

  return (
    <AuthGuard>
      <AppShell>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">权限组管理</h1>
          <p className="text-sm text-slate-500">管理用户账号、邮箱与权限组。</p>
        </div>

        <Card className="border border-slate-200 bg-white">
          <CardContent className="space-y-4 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex w-full max-w-md items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <Search className="h-4 w-4 text-slate-400" />
                <Input
                  className="h-8 border-0 bg-transparent p-0 focus-visible:ring-0"
                  placeholder="搜索账号或邮箱"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <Button onClick={openCreate} className="gap-2">
                <Plus className="h-4 w-4" />
                新增用户
              </Button>
            </div>

            {message ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                {message}
              </div>
            ) : null}

            {loading ? (
              <div className="text-sm text-slate-500">正在加载...</div>
            ) : filteredUsers.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 py-16 text-center">
                <UserCog className="h-8 w-8 text-slate-400" />
                <p className="mt-2 text-sm text-slate-500">暂无用户数据</p>
                <Button className="mt-4 gap-2" onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  新增用户
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>账号</TableHead>
                    <TableHead>邮箱</TableHead>
                    <TableHead>权限组</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((user) => {
                    const disabled = user.role_group === "admin";
                    return (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium text-slate-900">
                          {user.username}
                        </TableCell>
                        <TableCell className="text-slate-600">{user.email}</TableCell>
                        <TableCell className="text-slate-600">{user.role_group}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={disabled}
                              className={disabled ? "cursor-not-allowed" : ""}
                              onClick={() => openEdit(user)}
                            >
                              编辑
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={disabled}
                              className={disabled ? "cursor-not-allowed text-slate-400" : "text-red-600"}
                              onClick={() => openDelete(user)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>新增用户</DialogTitle>
              <DialogDescription>创建一个新的用户账号。</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="create-username">账号</Label>
                <Input
                  id="create-username"
                  value={formState.username}
                  onChange={(event) =>
                    setFormState({ ...formState, username: event.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-email">邮箱</Label>
                <Input
                  id="create-email"
                  type="email"
                  value={formState.email}
                  onChange={(event) =>
                    setFormState({ ...formState, email: event.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-password">密码</Label>
                <div className="relative">
                  <Input
                    id="create-password"
                    type={showPassword ? "text" : "password"}
                    value={formState.password}
                    onChange={(event) =>
                      setFormState({ ...formState, password: event.target.value })
                    }
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
                <Label htmlFor="create-password-confirm">重复输入密码</Label>
                <div className="relative">
                  <Input
                    id="create-password-confirm"
                    type={showPasswordConfirm ? "text" : "password"}
                    value={formState.passwordConfirm}
                    onChange={(event) =>
                      setFormState({ ...formState, passwordConfirm: event.target.value })
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswordConfirm((prev) => !prev)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500"
                  >
                    {showPasswordConfirm ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>权限组</Label>
                <Select
                  value={formState.role_group}
                  onValueChange={(value) =>
                    setFormState({ ...formState, role_group: value as "user" | "temp" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择权限组" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">用户（User）</SelectItem>
                    <SelectItem value="temp">临时用户（Temporary User）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowCreate(false)}>
                  取消
                </Button>
                <Button onClick={handleCreate}>确认</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={showEdit} onOpenChange={setShowEdit}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>编辑用户</DialogTitle>
              <DialogDescription>修改用户信息与权限组。</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-username">账号</Label>
                <Input
                  id="edit-username"
                  value={formState.username}
                  onChange={(event) =>
                    setFormState({ ...formState, username: event.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-email">邮箱</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={formState.email}
                  onChange={(event) =>
                    setFormState({ ...formState, email: event.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-password">密码（可选）</Label>
                <div className="relative">
                  <Input
                    id="edit-password"
                    type={showPassword ? "text" : "password"}
                    value={formState.password}
                    onChange={(event) =>
                      setFormState({ ...formState, password: event.target.value })
                    }
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
                <Label htmlFor="edit-password-confirm">重复输入密码</Label>
                <div className="relative">
                  <Input
                    id="edit-password-confirm"
                    type={showPasswordConfirm ? "text" : "password"}
                    value={formState.passwordConfirm}
                    onChange={(event) =>
                      setFormState({ ...formState, passwordConfirm: event.target.value })
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswordConfirm((prev) => !prev)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500"
                  >
                    {showPasswordConfirm ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>权限组</Label>
                <Select
                  value={formState.role_group}
                  onValueChange={(value) =>
                    setFormState({ ...formState, role_group: value as "user" | "temp" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择权限组" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">用户（User）</SelectItem>
                    <SelectItem value="temp">临时用户（Temporary User）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowEdit(false)}>
                  取消
                </Button>
                <Button onClick={handleUpdate}>保存</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除</AlertDialogTitle>
              <AlertDialogDescription>
                将删除用户 {activeUser?.username}（{activeUser?.email}），此操作不可恢复。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>确认删除</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </AppShell>
    </AuthGuard>
  );
}
