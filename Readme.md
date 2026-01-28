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

---

## 数据表一览

| 表名 | 作用 |
|----|----|
| `anime` | 番剧主表，存放番剧基础信息与详情页字段 |
| `anime_episode` | 番剧章节 / 集数列表 |
| `anime_airing_calendar` | 更新日历表，用于“某天更新了哪些番剧” |

---

## 文档目录（Docs）

- docs/database/anime-guide-schema.md：新番导视相关数据表结构与字段说明

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
│   └── settings/
│       ├── account/           # 账号信息修改
│       ├── password/          # 密码修改
│       └── permissions/       # 权限组管理
│   └── api/                  # 可选：Next.js API / BFF
├── components/               # 通用组件
│   ├── ui/                    # shadcn/ui 组件
│   ├── AuthGuard.tsx          # 登录保护
│   └── AppShell.tsx           # 应用壳（侧边栏）
│   └── anime-guide/           # 新番导视业务组件
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
│   │   └── admin_users.py    # 权限组管理（admin）
│   │   └── tools.py          # 工具相关 API
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
│       └── admin_user.py     # 权限组管理
├── requirements.txt
└── Dockerfile（可选）

---

## 认证与权限模型

- 前端通过 `/auth/login` 登录，后端签发 JWT
- JWT 存储在 `localStorage`（key: `auth_token`）
- 前端调用 FastAPI 时，通过 Header 传递：

Authorization: Bearer 

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

### 后端（FastAPI）

DATABASE_URL=
JWT_SECRET=
JWT_ALGORITHM=HS256
JWT_EXPIRES_MINUTES=60

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
