# galileocat-webtool 项目结构总览

## 1. 项目定位

`galileocat-webtool` 是一个面向个人使用和持续扩展的工具集合网站。它由 Next.js 前端、FastAPI 后端和独立 DSA 服务构成，业务数据使用 ADB Supabase 托管的 PostgreSQL 数据库，并可通过 Docker Compose 在单机部署。

当前功能主要包括：账号与权限管理、动漫新番导视及抓取、AI Workflow 嵌入管理、投资气象站，以及投资走势预测任务。

## 2. 总体架构

```text
浏览器
  │
  ▼
frontend/  Next.js 14 + React + TypeScript
  ├─ 页面、组件、JWT 登录态与请求封装
  ├─ /api/invest-weather/*：行情聚合与本地缓存
  └─ HTTP/JSON（NEXT_PUBLIC_API_BASE_URL）
  │
  ▼
backend/   FastAPI + SQLAlchemy
  ├─ 认证、权限、业务 API
  ├─ 动漫爬虫调度、投资预测任务
  └─ DATABASE_URL
  │
  ▼
ADB Supabase / PostgreSQL
```

补充边界：前端不直接写数据库；认证与业务授权由 FastAPI 实现。投资气象站的五个行情接口位于 Next.js Route Handlers，而不经过 FastAPI。

## 3. 根目录

```text
.
├── frontend/              # Next.js 前端应用
├── backend/               # FastAPI 后端应用、任务数据与测试
├── dsa/                   # 内嵌式 Daily Stock Analysis 独立服务（上游源码）
├── docs/                  # 数据库、部署与指标口径文档
├── docker-compose.yml     # 生产基线编排：frontend、backend、dsa
├── docker-compose.local.yml # 仅宿主机开发覆盖：暴露 DSA 回环调试端口
├── Readme.md              # 项目功能与使用说明
└── LICENSE                # 开源许可
```

## 4. 前端：`frontend/`

技术栈为 Next.js 14 App Router、React 18、TypeScript、Tailwind CSS、Radix/shadcn 风格组件、lucide-react 和 klinecharts。

```text
frontend/
├── app/
│   ├── page.tsx                                  # 首页
│   ├── login/                                    # 登录页
│   ├── dashboard/                                # 登录后的工具面板与爬虫入口
│   ├── settings/                                 # 账号、密码、权限组管理
│   ├── apps/
│   │   ├── anime-guide/                          # 新番导视列表与详情
│   │   ├── ai-workflow/                          # 工作流卡片列表、iframe 详情
│   │   ├── console/anime-crawler/                # 爬虫控制台
│   │   ├── invest-weather-station/               # 五类市场气象页面
│   │   └── investment-prediction/                # 投资预测任务页面
│   └── api/invest-weather/                       # 纳指、标普、黄金、港股、A 股数据接口
├── components/
│   ├── ui/                                       # 基础 UI 组件
│   ├── AppShell.tsx                              # 应用布局与侧边导航
│   ├── AuthGuard.tsx                             # 前端登录保护
│   ├── anime-guide/                              # 日历、封面、评分、章节等业务组件
│   ├── invest-weather/                           # 市场仪表板与专业图表
│   └── tools/                                    # 首页工具卡片与轮播
├── lib/
│   ├── api.ts                                    # 后端 API 请求封装
│   ├── auth.ts                                   # JWT 存取
│   ├── tools.ts                                  # 工具定义
│   ├── invest-weather/public-index-ohlc.ts       # OHLC 数据处理
│   └── mock/                                     # 动漫导视 Mock 数据
├── public/images/                                # 静态图片
├── .cache/invest-weather/                        # 行情本地缓存快照（运行数据）
├── package.json                                  # npm 依赖与 dev/build/start 脚本
└── Dockerfile                                    # 多阶段 Node 20 生产镜像
```

### 前端路由分组

| 分组 | 主要路径 | 作用 |
| --- | --- | --- |
| 公共与身份 | `/`、`/login`、`/dashboard` | 首页、登录和工具主面板 |
| 用户设置 | `/settings/account`、`/settings/password`、`/settings/permissions` | 个人资料、密码与管理员权限组维护 |
| 动漫 | `/apps/anime-guide`、`/apps/anime-guide/[id]` | 新番更新、详情和章节展示 |
| AI 工作流 | `/apps/ai-workflow`、`/apps/ai-workflow/[id]` | 工作流配置与 Dify iframe 页面 |
| 投资气象站 | `/apps/invest-weather-station/{nasdaq,sp500,gold,hk,a-share}` | 五个市场页面 |
| 投资预测 | `/apps/investment-prediction` | 策略选择、任务运行与结果查看 |
| DSA 系统 | `/apps/dsa` | 同域 iframe 嵌入的独立股票分析服务 |

## 5. 后端：`backend/`

后端使用 Python 3.12、FastAPI、Pydantic、SQLAlchemy/psycopg2、PyJWT、passlib，以及 requests、BeautifulSoup、APScheduler、pandas/numpy/openpyxl。

```text
backend/
├── app/
│   ├── main.py                                  # 应用创建、CORS、路由与爬虫生命周期
│   ├── core/
│   │   ├── config.py                            # 环境变量与 CORS/JWT/数据库配置
│   │   ├── db.py                                # SQLAlchemy 数据库会话
│   │   ├── security.py                          # 当前用户与鉴权依赖
│   │   └── password.py                          # 密码哈希工具
│   ├── api/                                     # HTTP 路由层
│   ├── schemas/                                 # Pydantic 请求/响应模型
│   └── services/                                # 用户、爬虫、预测等业务实现
├── data/investment_prediction/                  # 预测任务生成的数据与行情缓存
├── tests/                                       # 投资预测测试
├── requirements.txt                             # Python 依赖
└── Dockerfile                                   # Python 3.12 / Uvicorn 镜像
```

### 后端 API 模块

| 路由前缀 | 模块 | 职责 |
| --- | --- | --- |
| `/health` | `health.py` | 服务及数据库健康检查 |
| `/auth/*`、`/me` | `auth.py` | 验证码、登录、当前用户 |
| `/admin/users` | `admin_users.py` | 管理员用户增删改查 |
| `/settings` | `settings.py` | 账号资料和密码更新 |
| `/tools` | `tools.py` | 工具状态、AI 工作流与 Dify 会话同步 |
| `/tools/anime-guide` | `anime_guide.py` | 日历、更新、详情和抓取状态 |
| `/tools/anime-crawler` | `anime_crawler_logs.py` | 爬虫运行、日志列表与日志尾部 |
| `/tools/investment-prediction` | `investment_prediction.py` | 策略、异步任务、历史、状态、原始报告下载、每日定时设置和清理 |

### 关键业务服务

- `user_service.py`：用户查询、资料和密码修改，以及管理员用户管理。
- `login_guard_service.py`：内存验证码、失败计数与登录锁定。
- `anime_crawler/`：以 Bangumi 为数据源；`http_client.py` 提供主/备用域名及代理支持，`calendar.py`、`subject.py`、`episode.py` 分别抓取日历、番剧与章节，`scheduler.py` 负责 APScheduler 定时调度和运行日志。
- `investment_prediction_service.py`：发现外部 Stock Screen 策略、管理手动/定时任务、结果、状态、原始 Excel 输出文件和日志。
- `investment_prediction_scheduler.py`：使用 APScheduler 按北京时间触发每日预测；任务执行时会跳过已有运行中的全站任务。
- `crawler_log_service.py`：读取动漫爬虫的运行记录和日志尾部。

## 6. 数据、外部服务与运行文件

| 类型 | 位置或服务 | 用途 |
| --- | --- | --- |
| 主数据库 | ADB Supabase PostgreSQL | 用户、动漫、爬虫日志、AI 工作流等持久化数据 |
| 动漫数据源 | Bangumi（`bgm.tv`，失败时 `bangumi.tv`） | 新番、详情和章节抓取；可配置 `BANGUMI_PROXY` |
| 行情数据 | 腾讯公开 K 线、东方财富备用、FRED | 投资气象站的市场/宏观数据 |
| 工作流集成 | Dify | iframe 工作流与会话同步 |
| 投资预测外部目录 | `../Stock_Screen_demo`（容器中 `/opt/stock_screen`） | 可执行策略来源，Compose 以只读卷挂载 |
| 运行日志 | `backend/logs/ai_workflow_sessions/`、爬虫日志目录 | AI 会话和爬虫运行记录 |
| 运行缓存 | `frontend/.cache/invest-weather/`、`backend/data/investment_prediction/` | 行情快照、预测任务产物及可下载的原始 Excel 报告 |

投资预测任务包含 `task_type`（手动 / 定时）和 `status`（运行中 / 成功 / 失败）；前端历史列表静默刷新运行中的状态。定时设置包含开关与每日执行时分，后端采用 `Asia/Shanghai` 时区。新环境执行基础表结构脚本；已有环境须额外执行增量迁移脚本。数据库相关的建表/迁移说明见 `docs/database/`：动漫表结构、AI Workflow Supabase 迁移、爬虫运行日志，以及投资预测表结构。

## 7. 部署与启动关系

`docker-compose.yml` 定义三个生产服务：

```text
浏览器 ──> frontend :3000 ──HTTP──> backend :8888 ──DATABASE_URL──> PostgreSQL
                 │                    │
                 │                    └── /opt/stock_screen（只读策略目录）
                 └── /dsa 反向代理 ──> dsa :8000 ──DSA_DATABASE_URL──> PostgreSQL（仅 dsa_* 表）
```

- 后端读取 `backend/.env`，其中包含数据库、JWT、Supabase、Bangumi 代理等配置。
- DSA 读取 `dsa/.env` 中的模型、行情、搜索和通知配置；该文件不入库，每个环境必须独立配置。根目录 `.env` 仅向 DSA 注入 `DSA_DATABASE_URL`、`DSA_SSO_SECRET` 和 Cookie 安全设置。
- Compose 根目录 `.env` 控制前端公开 API 地址、允许的前端来源、`FRED_API_KEY` 与 DSA 容器配置。
- 后端健康检查为 `GET /health`；前端等待后端通过检查后再启动。
- 生产部署细节见 `docs/deployment/tencent-cloud-docker.md`。

### 开发与生产环境边界（必须遵守）

本项目不以开发机地址作为生产配置来源。地址、密钥与运行数据都必须按环境独立配置；代码只保留开发时的合理默认值，生产部署必须显式注入生产变量。

| 项目 | 本地开发 | 生产部署 |
| --- | --- | --- |
| Compose 命令 | `docker compose -f docker-compose.yml -f docker-compose.local.yml ...`（仅需要宿主机调试 DSA 时） | 只使用 `docker compose ...`；禁止合并 `docker-compose.local.yml` |
| DSA 服务地址 | 宿主机 Next dev 可使用 `http://127.0.0.1:8010` | 前端构建时必须使用 Docker 服务 DNS `http://dsa:8000`，浏览器只访问同域 `/dsa` |
| 后端 API 地址 | `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8888` 可用于本机浏览器 | 必须设置为真实生产 API 地址；禁止在页面代码中写死 `127.0.0.1` 或 `localhost` |
| 容器访问宿主机 | `127.0.0.1` 只表示当前容器 | 需要宿主机代理时使用 `host.docker.internal`，并依赖 Compose 的 `host-gateway` 映射 |
| DSA Cookie | 本地 HTTP 调试时可临时 `DSA_COOKIE_SECURE=false` | HTTPS 必须为 `DSA_COOKIE_SECURE=true` |
| 密钥与环境文件 | 可用本机独立 `.env` / `dsa/.env` | 在服务器单独维护同名文件；不得复制开发库、提交 Git 或在日志/聊天中泄露 |

Next.js 的 `NEXT_PUBLIC_*` 变量和 `DSA_INTERNAL_URL` rewrite 均在镜像构建期写入产物；修改它们后必须重建 `frontend` 镜像，单纯重启容器不会生效。`DSA_INTERNAL_URL` 只能在容器构建期使用 `http://dsa:8000`，不能使用宿主机 `127.0.0.1:8010`。

## 8. 文档索引

| 文件 | 内容 |
| --- | --- |
| `Readme.md` | 功能总说明、技术选型、接口和数据库概览 |
| `docs/database/anime-guide-schema.md` | 动漫导视表设计 |
| `docs/database/ai-workflow-supabase-migration.sql` | AI Workflow 数据迁移 |
| `docs/database/crawler-run-logs-readme.md` | 爬虫运行日志模型 |
| `docs/database/investment-prediction-schema.sql` | 投资预测任务表结构 |
| `docs/database/investment-prediction-task-status-migration.sql` | 已有投资预测表的定时设置、任务类型与状态增量迁移 |
| `docs/invest-weather/judgement-logic.md` | 五类市场的指标、数据与判定口径 |
| `docs/deployment/tencent-cloud-docker.md` | 腾讯云 Docker 部署与排障 |
| `docs/deployment/dsa-embedded-service.md` | DSA 的 Supabase、SSO 与本地/生产部署边界 |

## 9. 维护注意点

- 当前文档说明 Supabase RLS 处于 disabled 状态，因此所有敏感数据接口必须继续经由后端的认证与角色校验。
- FastAPI 启动时注册动漫爬虫和投资预测调度器；生产环境应保持单进程，避免重复执行定时任务。
- 数据库结构不由应用自动变更；在 Supabase SQL Editor 手动执行 `docs/database/` 中对应的 SQL 脚本后再部署代码。
- `frontend/.cache/`、`backend/data/` 和日志目录包含运行产物，通常不应作为稳定源码接口依赖。
- 工作流会话日志及环境变量可能含敏感信息，提交或迁移前应进行脱敏检查。
- 发布前需在目标环境执行 `docker compose config -q`，并对需要重建的服务显式 `--build`；不要依赖开发机正在运行的容器、端口、缓存或 `.env`。
