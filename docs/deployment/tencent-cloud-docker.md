# 腾讯云 4C4G + Docker 部署指南

本文档用于把 `galileocat-webtool` 部署到腾讯云轻量/云服务器（4C4G 规格），采用 `Docker Compose` 同机部署前后端。

## 1. 部署目标

- 前端：`Next.js`，端口 `3000`
- 后端：`FastAPI`，端口 `8888`
- 数据库：外部 PostgreSQL（如 Supabase）

## 2. 服务器准备

- 操作系统建议：Ubuntu 22.04 LTS
- 安全组放行：
  - `22`（SSH）
  - `3000`（前端）
  - `8888`（后端 API）

安装 Docker 与 Compose（Ubuntu）：

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```

执行完后重新登录一次 SSH，使 `docker` 免 `sudo` 生效。

## 3. 拉取项目

```bash
git clone <your-repo-url> galileocat-webtool
cd galileocat-webtool
```

## 4. 配置环境变量

项目已提供模板文件：

- `backend/.env.example`
- `.env.docker.example`

复制并编辑：

```bash
cp backend/.env.example backend/.env
cp .env.docker.example .env.docker
```

### 4.1 `backend/.env`

至少配置以下项：

```env
DATABASE_URL=postgresql+psycopg2://postgres:password@db-host:5432/postgres
JWT_SECRET=replace-with-a-long-random-secret
JWT_ALGORITHM=HS256
JWT_EXPIRES_MINUTES=60
```

如果有多个前端来源（例如域名 + IP），可逗号分隔：

```env
CORS_ALLOW_ORIGINS=http://your-ip:3000,https://your-domain.com
```

### 4.2 `.env.docker`

```env
# 浏览器访问时调用的后端地址（构建前端时写入）
NEXT_PUBLIC_API_BASE_URL=http://YOUR_SERVER_IP:8888

# 后端 CORS 放行来源
FRONTEND_PUBLIC_ORIGIN=http://YOUR_SERVER_IP:3000
```

注意：`NEXT_PUBLIC_API_BASE_URL` 是前端构建参数，修改后需要重新 build 前端镜像。

## 5. 启动服务

先准备日志目录（宿主机）：

```bash
mkdir -p backend/logs/anime_crawler
```

```bash
docker compose --env-file .env.docker up -d --build
```

查看状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f backend
docker compose logs -f frontend
```

日志说明：

- 宿主机日志目录：`backend/logs/anime_crawler/`
- 容器内日志目录：`/app/logs/anime_crawler/`
- 两者已通过 `docker-compose` volume 挂载同步。

## 6. 访问与验证

- 前端首页：`http://YOUR_SERVER_IP:3000`
- 后端健康检查：`http://YOUR_SERVER_IP:8888/health`
- 后端数据库健康检查：`http://YOUR_SERVER_IP:8888/health/db`

如 `health` 正常但 `health/db` 失败，优先检查：

- `DATABASE_URL` 是否正确
- 数据库白名单是否放行服务器公网 IP
- 云数据库端口是否可达

## 7. 更新发布流程

代码更新后执行：

```bash
git pull
docker compose --env-file .env.docker up -d --build
```

仅重启某个服务：

```bash
docker compose restart backend
docker compose restart frontend
```

## 8. 常见问题

1. 前端打开后接口报 CORS
- 检查 `backend/.env` 中 `CORS_ALLOW_ORIGINS` 是否包含前端真实访问地址（协议 + 域名/IP + 端口）。

2. 前端访问到了旧 API 地址
- `NEXT_PUBLIC_API_BASE_URL` 在构建时注入，修改后必须重新执行 `docker compose ... up -d --build`。

3. 后端容器启动失败，提示缺少环境变量
- 检查 `backend/.env` 是否存在且填写完整。

4. 登录失败但接口可通
- 检查 `JWT_SECRET` 是否在不同环境下一致，避免签发与校验不一致。

5. 日志列表有记录但日志框提示找不到文件
- 这是多环境共用数据库时的常见现象（记录来自其他机器）。
- 当前页面会提示“日志文件不在本地或已清理”。
- 如需跨机器统一可读，建议改为对象存储（COS/S3/Supabase Storage）集中存放日志文件。

## 9. 生产建议

- 当前为双端口直连模式（3000/8888）。生产建议使用 Nginx/Caddy 统一反向代理到 `80/443` 并开启 HTTPS。
- 建议为 `JWT_SECRET` 使用 32 字节以上随机字符串。
- 建议开启数据库最小权限或连接白名单，避免长期暴露高权限连接串。
- 本项目后端包含定时抓取任务，建议保持单实例运行，避免重复抓取。
- 新番爬虫每次运行完成后会自动清理 30 天前的运行日志记录与本地日志文件。
