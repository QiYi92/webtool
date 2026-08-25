-- 投资走势预测：定时设置、任务类型和任务状态迁移
-- 可直接粘贴至 Supabase SQL Editor 执行。

BEGIN;

CREATE TABLE IF NOT EXISTS investment_prediction_schedule (
    id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    enabled boolean NOT NULL DEFAULT false,
    hour smallint NOT NULL DEFAULT 9 CHECK (hour BETWEEN 0 AND 23),
    minute smallint NOT NULL DEFAULT 0 CHECK (minute BETWEEN 0 AND 59),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE investment_prediction_tasks
    ADD COLUMN IF NOT EXISTS task_type varchar(20) NOT NULL DEFAULT 'manual'
        CHECK (task_type IN ('manual', 'scheduled'));

ALTER TABLE investment_prediction_tasks
    ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'success', 'failed'));

-- 已结束的旧任务在旧表中没有失败标记，按历史行为视为执行成功。
UPDATE investment_prediction_tasks
SET status = 'success'
WHERE finished_at IS NOT NULL AND status = 'running';

COMMIT;
