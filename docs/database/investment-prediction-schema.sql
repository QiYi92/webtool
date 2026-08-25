BEGIN;

CREATE TABLE IF NOT EXISTS investment_prediction_tasks (
    id uuid PRIMARY KEY,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz NULL,
    hit_count integer NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
    task_type varchar(20) NOT NULL DEFAULT 'manual'
        CHECK (task_type IN ('manual', 'scheduled')),
    status varchar(20) NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'success', 'failed'))
);

CREATE TABLE IF NOT EXISTS investment_prediction_results (
    task_id uuid NOT NULL
        REFERENCES investment_prediction_tasks(id)
        ON DELETE CASCADE,
    stock_code varchar(6) NOT NULL,
    stock_name varchar(100) NOT NULL,
    stock_category varchar(30) NOT NULL,
    bowl_stage varchar(30) NOT NULL,
    sector varchar(100) NOT NULL,
    PRIMARY KEY (task_id, stock_code)
);

CREATE INDEX IF NOT EXISTS idx_investment_prediction_tasks_started_at
    ON investment_prediction_tasks (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_investment_prediction_results_task_id
    ON investment_prediction_results (task_id);

CREATE TABLE IF NOT EXISTS investment_prediction_schedule (
    id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    enabled boolean NOT NULL DEFAULT false,
    hour smallint NOT NULL DEFAULT 9 CHECK (hour BETWEEN 0 AND 23),
    minute smallint NOT NULL DEFAULT 0 CHECK (minute BETWEEN 0 AND 59),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
