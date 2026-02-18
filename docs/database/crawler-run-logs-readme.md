# Crawler Run Logs 表说明

本文档说明新番爬虫运行日志表 `crawler_run_logs` 的设计与使用方式。  
该表用于记录每次爬虫任务的元数据，日志正文保存在项目文件中，数据库仅保存路径和摘要信息。

---

## 设计目标

- 区分运行来源：手动 / 定时 / 自启
- 记录运行状态：进行中 / 成功 / 失败
- 支持控制台列表查询：最近运行、按状态筛选、按类型筛选
- 避免数据库存储大体积日志正文（仅存 `log_path`）

---

## 相关枚举

### 1) `crawler_run_type`

```text
manual / scheduled / autostart
```

### 2) `crawler_run_status`

```text
running / success / failed
```

---

## 表结构

```text
crawler_run_logs

字段名          类型                  说明
id              uuid                  主键，默认 gen_random_uuid()
log_path        text                  日志文件路径（项目内路径）
run_type        crawler_run_type      运行类型：manual/scheduled/autostart
crawler_name    text                  爬虫名称，默认 anime_guide
status          crawler_run_status    运行状态：running/success/failed
started_at      timestamptz           开始时间
finished_at     timestamptz           结束时间
duration_ms     integer               耗时（毫秒，>=0）
command         text                  触发命令/来源描述
summary         text                  运行摘要（建议简短）
error_message   text                  错误摘要（不要写完整堆栈）
created_at      timestamptz           创建时间
updated_at      timestamptz           更新时间（触发器自动更新）
```

---

## 触发器

- 触发器：`trg_crawler_run_logs_updated_at`
- 作用：每次更新自动刷新 `updated_at`
- 函数：`public.set_updated_at()`

---

## 索引

```text
idx_crawler_run_logs_started_at     (started_at DESC)
idx_crawler_run_logs_crawler_name   (crawler_name)
idx_crawler_run_logs_status         (status)
idx_crawler_run_logs_run_type       (run_type)
```

---

## 与当前代码的对应关系

当前后端调度实现中：

- 任务开始：插入一条 `status=running` 记录
- 任务结束：更新为 `success/failed`，并写入 `finished_at`、`duration_ms`、`summary`、`error_message`
- `log_path` 对应本地文件，例如：
  - `backend/logs/anime_crawler/2026-02-18_040723_681580.txt`

---

## 常用查询示例

### 1) 最近 20 次运行

```sql
select
  id,
  crawler_name,
  run_type,
  status,
  started_at,
  finished_at,
  duration_ms,
  log_path,
  summary
from public.crawler_run_logs
order by started_at desc
limit 20;
```

### 2) 查询失败记录

```sql
select
  id,
  run_type,
  started_at,
  error_message,
  log_path
from public.crawler_run_logs
where status = 'failed'
order by started_at desc
limit 50;
```

### 3) 按类型查看（定时任务）

```sql
select
  id,
  status,
  started_at,
  duration_ms,
  summary
from public.crawler_run_logs
where run_type = 'scheduled'
order by started_at desc
limit 50;
```

