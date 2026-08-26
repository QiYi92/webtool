# galileocat-webtool

galileocat-webtool 是一个 **个人工具类网站项目**，采用清晰、现代、可扩展的全栈架构，适合个人开发者长期维护与迭代。

---

## 项目目标

- 构建一个 **个人工具集合网站**
- 支持用户登录、数据隔离
- 前后端职责清晰，避免过度耦合
- 代码结构简单、可读、易扩展
- 适合单人开发与后期功能增长

---

## 技术架构概览

本项目采用 **前端 / 后端 / 基础设施 解耦架构**：

┌──────────────┐        HTTP / JSON        ┌──────────────┐
│   Next.js    │  ───────────────────▶   │   FastAPI    │
│   前端应用   │                          │   后端服务   │
│              │                          │              │
│ - 页面/UI    │        JWT (Auth)        │ - 核心业务   │
│ - 登录态     │  ───────────────────▶   │ - 工具逻辑   │
│ - 调用 API   │                          │ - 外部接口   │
└──────────────┘                          └──────────────┘
│
│ PostgreSQL 直连（DATABASE_URL）
▼
┌────────────────────────────────────────────┐
│        ADB Supabase（PostgreSQL）          │
│  - 托管 PostgreSQL 数据库                  │
│  - 当前项目 RLS 为 disabled                │
└────────────────────────────────────────────┘

---

## 动漫新番导视（Anime Guide）数据模型说明

本项目中的 **新番导视** 功能目前仅接入 **Bangumi（bgm.tv）** 作为数据源，  
数据由后端爬虫定期抓取并写入 ADB Supabase（PostgreSQL），前端仅做只读展示。

爬虫访问策略：

- 默认优先访问 `https://bgm.tv`
- 如果请求失败，会自动尝试备用域名 `https://bangumi.tv`
- 日历、详情、章节请求统一走 `backend/app/services/anime_crawler/http_client.py`
- 如果本机或服务器无法直连 Bangumi，需要配置 `BANGUMI_PROXY`

---

## Ai 工作流（AI Workflow）

新增应用：`/apps/ai-workflow`，用于以窗口卡片形式管理和访问 Dify 工作流入口。

### 数据表：`public.ai_workflow`

| 字段 | 类型 | 说明 |
|----|----|----|
| `id` | `uuid` PK | 主键 |
| `name` | `text` | 工作流名称 |
| `url` | `text` | 工作流地址（iframe `src`） |
| `visible_role_groups` | `text[]` | 可见权限组（如 `['admin','user','temp']`） |
| `is_active` | `boolean` | 是否启用 |
| `sort_order` | `int` | 排序号 |
| `created_by` | `text` | 创建者标识（user.id / username） |
| `created_at` | `timestamptz` | 创建时间 |
| `updated_at` | `timestamptz` | 更新时间 |
| `dify_base_url` | `text` | Dify API 基础地址（可选） |
| `dify_api_key` | `text` | Dify API Key（可选） |
| `dify_user_prefix` | `text` | Dify 用户前缀（默认 `gcw`） |
| `dify_fixed_user` | `text` | 固定 Dify 用户标识（可选，优先） |
| `enable_session_sync` | `boolean` | 是否启用会话同步 |
| `last_synced_at` | `timestamptz` | 最近同步时间 |
| `metadata` | `jsonb` | 扩展配置 |

说明：
- 当前 Supabase RLS 为 `disabled`，但后端接口仍强制做权限过滤。
- 普通用户仅可见 `is_active = true` 且 `visible_role_groups` 包含自身 `role_group` 的窗口。
- `admin` 可创建/更新并查看全部窗口（含 inactive）。

### 新增后端路由（FastAPI）

- `GET /tools/ai-workflows`：获取当前用户可见窗口列表
- `GET /tools/ai-workflows/{id}`：获取单个窗口详情（用于 iframe 页面）
- `POST /tools/ai-workflows`：创建窗口（仅 admin）
- `PATCH /tools/ai-workflows/{id}`：更新窗口（仅 admin）
- `DELETE /tools/ai-workflows/{id}`：删除窗口（仅 admin）
- `POST /tools/ai-workflows/{id}/sessions/{session_id}/append`：追加会话消息并落盘
- `POST /tools/ai-workflows/{id}/sessions/{session_id}/sync-from-dify`：从 Dify `/messages` 同步并落盘
- `GET /tools/ai-workflows/{id}/dify/conversations`：获取 Dify 会话列表
- `GET /tools/ai-workflows/{id}/dify/messages`：获取 Dify 会话消息列表

### 会话日志落盘

- 根目录：`backend/logs/ai_workflow_sessions/`
- 每用户目录：`backend/logs/ai_workflow_sessions/{user_identifier}/`
- 每会话文件：`{workflow_id}_{session_id}.json`
- JSON 结构：`workflow_id/workflow_name/user/session_id/created_at/messages[]`

### 前端页面（当前）

- `/apps/ai-workflow`：工作流窗口卡片列表（admin 可创建/设置/删除）
- `/apps/ai-workflow/[id]`：iframe 嵌入页（当前不展示历史会话列表，进入页即新会话模式）

---

## 投资气象站（Invest Weather Station）

应用入口：`/apps/invest-weather-station`，包含五个子页：

- `/apps/invest-weather-station/nasdaq`
- `/apps/invest-weather-station/sp500`
- `/apps/invest-weather-station/gold`
- `/apps/invest-weather-station/hk`
- `/apps/invest-weather-station/a-share`

### 前端路由（Next.js App Router）

- `GET /api/invest-weather/nasdaq`
- `GET /api/invest-weather/sp500`
- `GET /api/invest-weather/gold`
- `GET /api/invest-weather/hk`
- `GET /api/invest-weather/a-share`

说明：

- 以上接口在 Next.js 侧实现（`frontend/app/api/invest-weather/*/route.ts`），不是 FastAPI 路由。
- 五个模块统一使用 `MarketWeatherDashboard` 公共页面组件和 `ProfessionalMarketChart` 专业图表组件。
- 专业图表基于 `klinecharts`，支持十字光标、tooltip、缩放、拖动以及当日 / 日 K / 周 K / 月 K 切换。
- 真实 OHLC 覆盖 A 股宽基、恒生/恒生科技/红利低波、纳斯达克综合指数和标普500；宏观单值序列使用同一控件的专业折线模式，不伪造蜡烛数据。
- 日 K、周 K、月 K各最多展示180个数据点；周/月 K由完整日线历史按首开、最高、最低、末收聚合。数据历史不足时展示全部可用数据。
- A 股、港股和美股指数行情优先使用腾讯公开 K 线，按模块保留东方财富备用源；纳指/标普 OHLC全部失败时回退到 FRED 折线。
- 黄金及宏观因子主要来自 FRED；所有 Next API 使用本地文件缓存（当前30分钟刷新一次），支持陈旧快照降级。
- 首页“工具”中的投资气象站轮播展示纳指、标普、黄金、港股恒生和沪深 A 股行情速览。

判定与口径文档：

- `docs/invest-weather/judgement-logic.md`

---

## 数据表一览

| 表名 | 作用 |
|----|----|
| `anime` | 番剧主表，存放番剧基础信息与详情页字段 |
| `anime_episode` | 番剧章节 / 集数列表 |
| `anime_airing_calendar` | 更新日历表，用于“某天更新了哪些番剧” |
| `ai_workflow` | AI 工作流窗口配置（权限组可见性 + iframe 地址） |

---

## 文档目录（Docs）

- docs/database/anime-guide-schema.md：新番导视相关数据表结构与字段说明
- docs/database/ai-workflow-supabase-migration.sql：AI 工作流表结构迁移脚本
- docs/database/crawler-run-logs-readme.md：爬虫运行日志说明
- docs/deployment/tencent-cloud-docker.md：腾讯云 4C4G + Docker 部署步骤与排障指南
- docs/invest-weather/judgement-logic.md：投资气象站指标判定逻辑与口径说明

---

## 权限与安全（RLS）

- 当前环境 RLS 为 disabled（ADB Supabase）
- 后端使用 `DATABASE_URL`（postgres 超级用户）直连读写
- 前端不持有数据库写权限，仅通过后端接口访问

---

## 技术选型

### 前端（Frontend）
- Next.js（App Router）
- React
- TypeScript
- Tailwind CSS
- shadcn/ui（基于 Radix UI）
- lucide-react（图标）

### 后端（Backend）
- Python 3.12（建议，3.13 可能出现依赖兼容问题）
- FastAPI
- Pydantic
- HTTPX / Requests（用于外部 API 调用）
- PyJWT + cryptography（JWT 校验）
- SQLAlchemy（sync）+ psycopg2（PostgreSQL）
- passlib[bcrypt]（密码哈希/校验）

### 数据与基础设施
- ADB Supabase（托管 PostgreSQL）
- Vercel（前端部署）
- Render / Fly.io（后端部署）
- Docker + 云服务器（可选自托管）

---

## 项目目录结构

### 前端（Next.js）

frontend/
├── app/
│   ├── page.tsx              # 首页（JWT 登录态）
│   ├── login/                # 登录页面
│   ├── dashboard/            # 工具主界面（登录示例）
│   ├── apps/                  # 应用页面分组
│   │   └── anime-guide/       # 新番导视
│   │   └── ai-workflow/       # AI Workflow 列表 + iframe 详情页
│   │   └── invest-weather-station/ # 投资气象站（首页 + nasdaq/sp500/gold/hk/a-share）
│   │   └── investment-prediction/ # 投资走势预测（碗形策略筛选）
│   │   └── console/anime-crawler/ # 新番爬虫控制台
│   └── api/
│       └── invest-weather/    # 投资气象站 Next API（nasdaq/sp500/gold/hk/a-share）
│   └── settings/
│       ├── account/           # 账号信息修改
│       ├── password/          # 密码修改
│       └── permissions/       # 权限组管理
├── components/               # 通用组件
│   ├── ui/                    # shadcn/ui 组件
│   ├── AuthGuard.tsx          # 登录保护
│   └── AppShell.tsx           # 应用壳（侧边栏）
│   └── anime-guide/           # 新番导视业务组件
│   └── tools/                 # 首页工具卡组件（含轮播展示）
├── lib/
│   ├── supabase.ts           # Supabase 客户端初始化（当前不使用）
│   ├── auth.ts               # JWT 存取工具
│   ├── api.ts                # API 请求封装
│   └── utils.ts              # className 合并工具
│   └── mock/                  # Mock 数据
│       └── animeGuideMock.ts  # 新番导视 Mock 数据
├── public/
│   └── images/                # 图片素材
├── tailwind.config.ts
├── postcss.config.js
├── components.json
└── package.json

---

### 后端（FastAPI）

backend/
├── app/
│   ├── main.py               # FastAPI 入口
│   ├── api/
│   │   ├── health.py         # 健康检查
│   │   ├── auth.py           # 登录 /me
│   │   ├── settings.py       # 账号/密码设置
│   │   ├── admin_users.py    # 权限组管理（admin）
│   │   ├── anime_guide.py    # 新番导视 API
│   │   ├── anime_crawler_logs.py # 新番爬虫日志与手动触发
│   │   ├── investment_prediction.py # 投资走势预测任务、日志与结果 API
│   │   └── tools.py          # 工具相关 API（含 AI 工作流）
│   ├── core/
│   │   ├── config.py         # 配置 / 环境变量
│   │   ├── db.py             # 数据库连接
│   │   ├── password.py       # 密码哈希
│   │   └── security.py       # JWT 校验
│   ├── services/
│   │   ├── business.py       # 业务逻辑层
│   │   └── user_service.py   # 用户数据操作
│   └── schemas/
│       ├── common.py         # Pydantic 数据模型
│       ├── user.py           # 登录/用户
│       ├── admin_user.py     # 权限组管理
│       └── ai_workflow.py    # AI Workflow 请求/响应模型
├── logs/
│   ├── anime_crawler/        # 新番爬虫日志
│   └── ai_workflow_sessions/ # AI Workflow 会话日志
├── requirements.txt
└── Dockerfile（可选）

---

## 认证与权限模型

- 前端通过 `/auth/login` 登录，后端签发 JWT
- JWT 存储在 `localStorage`（key: `auth_token`）
- 前端调用 FastAPI 时，通过 Header 传递：

Authorization: Bearer <token>

- FastAPI 使用自签发 JWT 校验
- 权限组管理接口仅允许 `role_group == admin`

---

## 各层职责说明

### Next.js（前端）
- 页面渲染与 UI 交互
- 用户登录 / 登出
- 调用 FastAPI 接口

### FastAPI（后端）
- 核心业务逻辑
- 工具计算 / 数据处理
- AI / 第三方 API 集成
- 权限校验与流程编排
- 用户与权限组管理

### ADB Supabase（PostgreSQL）
- 托管 PostgreSQL 数据库存储

---

## 环境变量配置

### 前端（Next.js）

NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8888
FRED_API_KEY=YOUR_FRED_API_KEY

### 后端（FastAPI）

DATABASE_URL=
JWT_SECRET=
JWT_ALGORITHM=HS256
JWT_EXPIRES_MINUTES=60
CORS_ALLOW_ORIGINS=http://localhost:3000
BANGUMI_PROXY=
BANGUMI_CONNECT_TIMEOUT=8
BANGUMI_READ_TIMEOUT=20

---

### Bangumi 爬虫网络配置

新番爬虫默认请求顺序为：

```text
https://bgm.tv
https://bangumi.tv
```

如果终端或服务器无法直连 Bangumi，但浏览器可以访问，通常是浏览器走了系统代理，而 Python 后端进程没有走代理。此时需要在 `backend/.env` 中配置：

```env
BANGUMI_PROXY=http://127.0.0.1:7892
BANGUMI_CONNECT_TIMEOUT=8
BANGUMI_READ_TIMEOUT=20
```

说明：

- `BANGUMI_PROXY` 只影响新番爬虫访问 `bgm.tv` / `bangumi.tv`
- 本机示例 `127.0.0.1:7892` 是 macOS 本地代理端口，服务器不能直接照抄
- 服务器必须填写服务器自身可访问的代理地址
- Docker 容器内的 `127.0.0.1` 指容器自身，不是宿主机

验证爬虫网络访问：

```bash
cd backend
source .venv/bin/activate
python - <<'PY'
from dotenv import load_dotenv
load_dotenv(".env")
from app.services.anime_crawler.http_client import fetch_bangumi_html
import logging
logging.basicConfig(level=logging.INFO)
html, url = fetch_bangumi_html("/calendar", logger=logging.getLogger("test"), log_label="测试")
print(url, len(html))
PY
```

完整验证一次爬虫调度：

```bash
cd backend
source .venv/bin/activate
python - <<'PY'
from dotenv import load_dotenv
load_dotenv(".env")
import logging
logging.basicConfig(level=logging.INFO)
from app.services.anime_crawler.scheduler import run_crawler_once
run_crawler_once(run_type="manual", command="manual validation")
PY
```

## 腾讯云服务器（4C4G）+ Docker 部署

推荐做法：`README` 只保留「部署速查」，完整步骤与排障放到独立子文档，便于长期维护。

### 部署速查（生产）

完整手册：`docs/deployment/tencent-cloud-docker.md`

```bash
# 1) 拉代码
cd /opt/webtool
git pull

# 2) 确保日志目录存在（宿主机）
mkdir -p backend/logs/anime_crawler
mkdir -p backend/logs/ai_workflow_sessions

# 3) 构建并启动
docker compose up -d --build

# 4) 查看状态与日志
docker compose ps
docker compose logs -f backend
docker compose logs -f frontend
```

说明：
- `docker compose` 默认读取项目根目录 `.env`（无需 `--env-file`）
- 后端日志目录已挂载：`/opt/webtool/backend/logs -> /app/logs`
- 新番爬虫每次运行结束会自动清理 30 天前的运行日志记录与对应日志文件
- 新番爬虫启动时仅注册定时任务（09:00 / 21:00），不再执行自启爬取
- 如果服务器访问 `bgm.tv` 超时，需要在 `backend/.env` 配置 `BANGUMI_PROXY` 后重建后端镜像

---

## 本地开发与启动

### 一键启动（VSCode）

已提供 VSCode 任务配置，使用默认构建任务可同时启动前后端：

- `Cmd/Ctrl+Shift+B` → 选择 `dev`
- 前端默认端口：`http://localhost:3000`
- 后端默认端口：`http://localhost:8888`

### 手动启动

前端：

```bash
cd frontend
npm install
npm run dev
```

后端（推荐使用 Python 3.12）：

```bash
cd backend
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8888
```

### 现有功能说明（最小可运行）

- `/login` 支持账号或邮箱登录（后端校验）
- `/` 首页需要登录态
- `/settings/account` 账号信息修改
- `/settings/password` 密码修改
- `/settings/permissions` 权限组管理（仅 admin 可见/可访问）
- `/apps/ai-workflow` AI工作流卡片列表（admin 支持创建/设置/删除）
- `/apps/ai-workflow/[id]` AI工作流 iframe 页面（新会话入口）
- `/apps/invest-weather-station` 投资气象站首页（纳指/标普/黄金/港股/A股入口）
- `/apps/invest-weather-station/nasdaq` 纳斯达克宏观气象站
- `/apps/invest-weather-station/sp500` 标普500宏观气象站
- `/apps/invest-weather-station/gold` 黄金宏观气象站
- `/apps/invest-weather-station/hk` 港股恒生气象站
- `/apps/invest-weather-station/a-share` 沪深 A 股气象站
- `GET /api/invest-weather/nasdaq|sp500|gold|hk|a-share` 投资气象站 Next API（30分钟缓存刷新）
- `/apps/console/anime-crawler` 新番爬虫控制台（admin）
- `/apps/investment-prediction` 投资走势预测（所有登录用户）
- `/apps/dsa` DSA系统（所有登录用户；本地开发需按 DSA 部署文档启动独立 DSA 容器）
- `POST /tools/anime-crawler/run` 手动触发一次爬虫任务（admin）
- `POST /tools/investment-prediction/run` 以指定策略启动筛选（全站单任务）

投资走势预测依赖同级目录中的 `Stock_Screen_demo` 项目。本地默认自动读取
`../Stock_Screen_demo`；Docker Compose 会将该目录只读挂载到
`/opt/stock_screen`。

### 投资走势预测补充说明

- 页面默认展示历史预测列表；列表会静默刷新运行中的任务，不会切换为加载占位状态。
- 历史任务记录任务类型（`manual` 手动执行 / `scheduled` 定时执行）和任务状态（`running`、`success`、`failed`）。界面显示为运行中、执行完成、执行失败。
- 历史详情和最新筛选结果均可下载原始 `.xlsx` 报告。报告是 `Stock_Screen_demo` 生成的原文件，保存路径为 `backend/data/investment_prediction/{task_id}.xlsx`，保留原有工作表和格式。
- 齿轮设置页分为“预测筛选设置”和“定时设置”。定时设置支持每天指定时分（北京时间）执行一次默认碗形策略；调度由后端 APScheduler 执行，浏览器关闭后仍有效。
- 同一时刻全站只允许一个预测任务运行；定时任务遇到已有运行任务会跳过本次执行。

| 接口 | 说明 |
| --- | --- |
| `GET /tools/investment-prediction/strategies` | 获取可用策略 |
| `POST /tools/investment-prediction/run` | 手动启动预测 |
| `GET /tools/investment-prediction/status` | 获取最近任务及实时状态 |
| `GET /tools/investment-prediction/tasks` | 分页查询历史任务 |
| `DELETE /tools/investment-prediction/tasks` | 删除历史任务及其日志、报告 |
| `GET /tools/investment-prediction/tasks/{task_id}/log` | 获取任务日志 |
| `GET /tools/investment-prediction/tasks/{task_id}/results` | 获取命中结果 |
| `GET /tools/investment-prediction/tasks/{task_id}/report` | 下载原始 Excel 报告 |
| `GET /tools/investment-prediction/schedule` | 获取每日定时设置 |
| `PUT /tools/investment-prediction/schedule` | 保存每日定时开关与执行时间 |

数据库结构由人工在 Supabase SQL Editor 中维护：新环境执行
`docs/database/investment-prediction-schema.sql`；已有投资预测表的环境还需执行
`docs/database/investment-prediction-task-status-migration.sql`，以添加定时设置表、任务类型和任务状态字段。
- 后端 `GET /health/db` 用于验证数据库连接（执行 `select 1`）

---

## 开发原则（重要）

- 保持代码 **简单、直接、可读**
- 避免过度抽象
- 不引入不必要的复杂架构
- 优先可维护性，而不是“设计感”
- 适合单人长期维护

---

## 代码生成说明（重要）

以下规则用于 **代码自动生成**：

- 前端使用 **TypeScript**
- 后端使用 **Python + FastAPI**
- 生成最小可运行代码
- 使用清晰、显式的实现方式
- 包含基础错误处理
- 不引入复杂状态管理或中间件
- 不实现多余功能

本 README 可作为 **代码生成上下文** 使用。
