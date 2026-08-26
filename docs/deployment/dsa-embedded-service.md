# DSA 系统部署

DSA 是独立容器，使用工具站的 Supabase PostgreSQL，但只访问 `dsa_*` 表；它与现有“投资走势预测”没有代码、任务或数据表关联。

## 首次部署

1. 在 Supabase SQL Editor 中完整粘贴并执行 `docs/database/dsa-supabase-schema.sql`。
2. 在根目录 `.env` 填写 `DSA_DATABASE_URL` 和至少 32 字节的随机 `DSA_SSO_SECRET`；在 `backend/.env` 使用相同的 `DSA_SSO_SECRET`。
3. 将 `dsa/.env.example` 复制为 `dsa/.env`，填写 DSA 容器所需的模型、行情、搜索与通知环境变量。不得将这些密钥写入前端环境变量。
4. 执行 `docker compose up -d --build`。前端通过同域 `/dsa` 代理该容器，浏览器无需访问 DSA 的独立端口。

## 宿主机本地开发

若前端是在宿主机以 `cd frontend && npm run dev` 启动，需使用本地 Compose 覆盖文件将 DSA 仅绑定到本机回环地址：

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build dsa
```

随后保持 `frontend/next.config.js` 的本地默认 `DSA_INTERNAL_URL=http://127.0.0.1:8010`，再访问 `http://localhost:3000/apps/dsa`。该覆盖文件不应部署到生产环境。

生产环境必须经 HTTPS 访问，并保持 `DSA_COOKIE_SECURE=true`；仅在本机 `http://localhost` 调试时临时设为 `false`。

DSA 启动时会校验所有 `dsa_*` 表是否存在；缺表会拒绝启动并提示执行 SQL 脚本，绝不会对 Supabase 自动建表。

## 后续数据库变更

DSA 结构变更必须新增一个可直接粘贴的 SQL migration 文件到 `docs/database/`，使用 `IF EXISTS` / `IF NOT EXISTS` 保证可重复执行。先由管理员在 Supabase SQL Editor 手动执行，再部署应用代码。

## 回滚

移除 DSA 容器和 `/dsa` 代理即可停止该模块，不会影响投资走势预测。保留 `dsa_*` 表可在恢复服务时继续使用；如需删除数据，应由管理员在 Supabase 确认后单独执行 SQL。
