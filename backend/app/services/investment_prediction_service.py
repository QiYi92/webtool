from __future__ import annotations

import importlib
import logging
import math
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock, Thread
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import text

from app.core.db import get_engine


STRATEGY_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
MAX_LOG_BYTES = 256 * 1024


def _detect_backend_root() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        if parent.name == "app":
            return parent.parent
    raise RuntimeError("Cannot locate backend root")


BACKEND_ROOT = _detect_backend_root()
DEFAULT_STOCK_SCREEN_ROOT = BACKEND_ROOT.parent.parent / "Stock_Screen_demo"
STOCK_SCREEN_ROOT = Path(
    os.getenv("STOCK_SCREEN_ROOT", str(DEFAULT_STOCK_SCREEN_ROOT))
).expanduser().resolve()
LOG_DIR = BACKEND_ROOT / "logs" / "investment_prediction"
DATA_DIR = BACKEND_ROOT / "data" / "investment_prediction"
DEFAULT_FILTER_SETTINGS = {
    "exclude_gem": True,
    "exclude_star_market": True,
    "exclude_insufficient_listing": True,
    "exclude_failed_year_trend": True,
    "exclude_insufficient_kline": True,
    "exclude_failed_volume": True,
    "exclude_failed_bowl": True,
}
FILTER_SETTING_LABELS = {
    "exclude_gem": "排除创业板",
    "exclude_star_market": "排除科创板",
    "exclude_insufficient_listing": "排除上市时间不足/缺失",
    "exclude_failed_year_trend": "排除一年趋势不通过",
    "exclude_insufficient_kline": "排除 K 线数据不足",
    "exclude_failed_volume": "排除成交量不通过",
    "exclude_failed_bowl": "排除碗型不通过",
}


def _serialize_datetime(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)


def _task_from_row(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "id": str(row["id"]),
        "started_at": _serialize_datetime(row["started_at"]),
        "finished_at": _serialize_datetime(row.get("finished_at")),
        "hit_count": int(row.get("hit_count") or 0),
        "task_type": row.get("task_type") or "manual",
        "status": row.get("status") or "failed",
    }


def list_strategies() -> list[str]:
    config_dir = STOCK_SCREEN_ROOT / "configs"
    if not config_dir.is_dir():
        raise RuntimeError(
            f"未找到 Stock_Screen_demo 策略目录：{config_dir}。"
            "请设置 STOCK_SCREEN_ROOT。"
        )
    return sorted(path.stem for path in config_dir.glob("*.json") if path.is_file())


def resolve_strategy_path(strategy: str) -> Path:
    normalized = strategy.strip()
    if not STRATEGY_NAME_PATTERN.fullmatch(normalized):
        raise ValueError("策略名称格式不正确")
    path = (STOCK_SCREEN_ROOT / "configs" / f"{normalized}.json").resolve()
    config_root = (STOCK_SCREEN_ROOT / "configs").resolve()
    if config_root not in path.parents or not path.is_file():
        raise ValueError(f"策略不存在：{normalized}")
    return path


def get_latest_task() -> dict[str, Any] | None:
    with get_engine().connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT id, started_at, finished_at, hit_count, task_type, status
                FROM investment_prediction_tasks
                ORDER BY started_at DESC
                LIMIT 1
                """
            )
        ).mappings().first()
    return _task_from_row(dict(row) if row else None)


def list_tasks(page: int = 1, page_size: int = 15) -> tuple[int, list[dict[str, Any]]]:
    offset = (page - 1) * page_size
    with get_engine().connect() as conn:
        total = int(
            conn.execute(
                text("SELECT COUNT(*) FROM investment_prediction_tasks")
            ).scalar_one()
        )
        rows = conn.execute(
            text(
                """
                SELECT id, started_at, finished_at, hit_count, task_type, status
                FROM investment_prediction_tasks
                ORDER BY started_at DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {"limit": page_size, "offset": offset},
        ).mappings().all()
    return total, [
        task
        for row in rows
        if (task := _task_from_row(dict(row))) is not None
    ]


def get_task(task_id: str) -> dict[str, Any] | None:
    UUID(task_id)
    with get_engine().connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT id, started_at, finished_at, hit_count, task_type, status
                FROM investment_prediction_tasks
                WHERE id = CAST(:task_id AS uuid)
                LIMIT 1
                """
            ),
            {"task_id": task_id},
        ).mappings().first()
    return _task_from_row(dict(row) if row else None)


def delete_tasks(task_ids: list[str]) -> list[str]:
    normalized_ids = list(dict.fromkeys(str(UUID(task_id)) for task_id in task_ids))
    if not normalized_ids:
        return []

    placeholders = ", ".join(
        f"CAST(:task_id_{index} AS uuid)" for index in range(len(normalized_ids))
    )
    parameters = {
        f"task_id_{index}": task_id
        for index, task_id in enumerate(normalized_ids)
    }
    with get_engine().begin() as conn:
        conn.execute(
            text(
                f"""
                DELETE FROM investment_prediction_results
                WHERE task_id IN ({placeholders})
                """
            ),
            parameters,
        )
        rows = conn.execute(
            text(
                f"""
                DELETE FROM investment_prediction_tasks
                WHERE id IN ({placeholders})
                RETURNING id
                """
            ),
            parameters,
        ).all()
    return [str(row[0]) for row in rows]


def delete_task_artifacts(task_ids: list[str]) -> None:
    for task_id in task_ids:
        safe_id = str(UUID(task_id))
        for path in (
            LOG_DIR / f"{safe_id}.log",
            DATA_DIR / f"{safe_id}.xlsx",
        ):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                logging.warning("无法删除投资预测任务文件：%s", path, exc_info=True)


def get_results(task_id: str) -> list[dict[str, Any]]:
    UUID(task_id)
    with get_engine().connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT stock_code, stock_name, stock_category, bowl_stage, sector
                FROM investment_prediction_results
                WHERE task_id = CAST(:task_id AS uuid)
                ORDER BY sector, stock_code
                """
            ),
            {"task_id": task_id},
        ).mappings().all()
    return [dict(row) for row in rows]


def get_report_path(task_id: str) -> Path:
    """Return the task's original Stock_Screen Excel output path safely."""
    safe_id = str(UUID(task_id))
    return DATA_DIR / f"{safe_id}.xlsx"


def get_schedule_settings() -> dict[str, int | bool]:
    with get_engine().connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT enabled, hour, minute
                FROM investment_prediction_schedule
                WHERE id = 1
                """
            )
        ).mappings().first()
    if not row:
        return {"enabled": False, "hour": 9, "minute": 0}
    return {
        "enabled": bool(row["enabled"]),
        "hour": int(row["hour"]),
        "minute": int(row["minute"]),
    }


def save_schedule_settings(enabled: bool, hour: int, minute: int) -> dict[str, int | bool]:
    with get_engine().begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO investment_prediction_schedule
                    (id, enabled, hour, minute, updated_at)
                VALUES (1, :enabled, :hour, :minute, NOW())
                ON CONFLICT (id) DO UPDATE SET
                    enabled = EXCLUDED.enabled,
                    hour = EXCLUDED.hour,
                    minute = EXCLUDED.minute,
                    updated_at = NOW()
                """
            ),
            {"enabled": enabled, "hour": hour, "minute": minute},
        )
    return {"enabled": enabled, "hour": hour, "minute": minute}


def _log_path(task_id: str) -> Path:
    safe_id = str(UUID(task_id))
    return LOG_DIR / f"{safe_id}.log"


def read_task_log(task_id: str) -> tuple[str, bool, int]:
    path = _log_path(task_id)
    if not path.is_file():
        return "", False, 0
    total_bytes = path.stat().st_size
    read_size = min(total_bytes, MAX_LOG_BYTES)
    with path.open("rb") as file_obj:
        if total_bytes > read_size:
            file_obj.seek(-read_size, 2)
        content = file_obj.read(read_size).decode("utf-8", errors="replace")
    return content, total_bytes > read_size, total_bytes


def _normalize_value(value: Any, fallback: str = "—") -> str:
    if value is None:
        return fallback
    if isinstance(value, float) and math.isnan(value):
        return fallback
    text_value = str(value).strip()
    return text_value or fallback


def normalize_stock_code(value: Any) -> str:
    text_value = _normalize_value(value, "")
    if text_value.endswith(".0"):
        text_value = text_value[:-2]
    if not text_value.isdigit() or len(text_value) > 6:
        raise ValueError(f"无效的股票代码：{value}")
    return text_value.zfill(6)


def classify_stock(stock_code: Any) -> str:
    try:
        code = normalize_stock_code(stock_code)
    except ValueError:
        return "其他"
    if code.startswith(("688", "689")):
        return "科创板"
    if code.startswith(("300", "301", "302")):
        return "创业板"
    if code.startswith(("4", "8", "92")):
        return "北交所"
    if code.startswith("6"):
        return "沪市主板"
    if code.startswith(("0", "1")):
        return "深市主板"
    return "其他"


def _result_rows(result: Any) -> list[dict[str, str]]:
    rows_by_code: dict[str, dict[str, str]] = {}
    for record in result.to_dict(orient="records"):
        stock_code = normalize_stock_code(record.get("股票代码"))
        rows_by_code[stock_code] = {
            "stock_code": stock_code,
            "stock_name": _normalize_value(record.get("股票名称")),
            "stock_category": classify_stock(stock_code),
            "bowl_stage": _normalize_value(record.get("碗型阶段")),
            "sector": _normalize_value(record.get("板块"), "未分类"),
        }
    return list(rows_by_code.values())


def _load_screen_module() -> Any:
    if not (STOCK_SCREEN_ROOT / "screen_bowl_shape.py").is_file():
        raise RuntimeError(
            f"未找到 Stock_Screen_demo：{STOCK_SCREEN_ROOT}。"
            "请设置 STOCK_SCREEN_ROOT。"
        )
    root_text = str(STOCK_SCREEN_ROOT)
    if root_text not in sys.path:
        sys.path.insert(0, root_text)
    module = importlib.import_module("screen_bowl_shape")
    module.OUTPUT_DIR = str(DATA_DIR)
    module.CACHE_DIR = DATA_DIR / "cache"
    return module


def build_filter_config_overrides(
    filters: dict[str, bool] | None,
) -> dict[str, dict[str, Any]]:
    settings = {**DEFAULT_FILTER_SETTINGS, **(filters or {})}
    excluded_board_prefixes: list[str] = []
    if settings["exclude_gem"]:
        excluded_board_prefixes.extend(["300", "301", "302"])
    if settings["exclude_star_market"]:
        excluded_board_prefixes.extend(["688", "689"])
    return {
        "basic": {
            "excluded_board_prefixes": excluded_board_prefixes,
            "enable_listing_filter": settings["exclude_insufficient_listing"],
            "enable_trend_filter": settings["exclude_failed_year_trend"],
            "enable_k_data_filter": settings["exclude_insufficient_kline"],
            "enable_volume_filter": settings["exclude_failed_volume"],
            "enable_bowl_filter": settings["exclude_failed_bowl"],
        }
    }


class PredictionTaskManager:
    def __init__(self) -> None:
        self._lock = Lock()
        self._thread: Thread | None = None
        self._task_id: str | None = None
        self._strategy: str | None = None
        self._status: str = "idle"
        self._error_message: str | None = None

    def start(
        self,
        strategy: str,
        filters: dict[str, bool] | None = None,
        task_type: str = "manual",
    ) -> str:
        if task_type not in {"manual", "scheduled"}:
            raise ValueError("任务类型不正确")
        strategy_path = resolve_strategy_path(strategy)
        filter_settings = {**DEFAULT_FILTER_SETTINGS, **(filters or {})}
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                raise RuntimeError("已有投资走势预测任务正在运行")

            task_id = str(uuid4())
            started_at = datetime.now(timezone.utc)
            with get_engine().begin() as conn:
                conn.execute(
                    text(
                        """
                        INSERT INTO investment_prediction_tasks
                            (id, started_at, finished_at, hit_count, task_type, status)
                        VALUES
                            (CAST(:id AS uuid), :started_at, NULL, 0, :task_type, 'running')
                        """
                    ),
                    {
                        "id": task_id,
                        "started_at": started_at,
                        "task_type": task_type,
                    },
                )

            LOG_DIR.mkdir(parents=True, exist_ok=True)
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            self._task_id = task_id
            self._strategy = strategy
            self._status = "running"
            self._error_message = None
            self._thread = Thread(
                target=self._run,
                args=(task_id, strategy, strategy_path, filter_settings),
                name=f"investment-prediction-{task_id}",
                daemon=True,
            )
            self._thread.start()
            return task_id

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            task_id = self._task_id
            status = self._status
            strategy = self._strategy
            error_message = self._error_message

        task = get_task(task_id) if task_id else get_latest_task()
        if task_id is None and task is not None:
            if task["finished_at"]:
                status = "success"
            else:
                status = "failed"
                error_message = "服务重启导致上一次任务中断，请重新执行"
        return {
            "status": status,
            "task": task,
            "strategy": strategy,
            "error_message": error_message,
        }

    def get_running_task_id(self) -> str | None:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return self._task_id
            return None

    def forget_deleted_tasks(self, task_ids: list[str]) -> None:
        deleted_ids = set(task_ids)
        with self._lock:
            if self._task_id not in deleted_ids:
                return
            if self._thread is not None and self._thread.is_alive():
                return
            self._thread = None
            self._task_id = None
            self._strategy = None
            self._status = "idle"
            self._error_message = None

    def _run(
        self,
        task_id: str,
        strategy: str,
        strategy_path: Path,
        filters: dict[str, bool],
    ) -> None:
        log_path = _log_path(task_id)
        handler = logging.FileHandler(log_path, encoding="utf-8")
        handler.setFormatter(
            logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")
        )
        handler.setLevel(logging.INFO)
        root_logger = logging.getLogger()
        previous_root_level = root_logger.level
        if previous_root_level > logging.INFO:
            root_logger.setLevel(logging.INFO)
        root_logger.addHandler(handler)
        task_logger = logging.getLogger("investment_prediction")
        try:
            task_logger.info("任务 %s 开始，策略：%s", task_id, strategy)
            enabled_filters = [
                FILTER_SETTING_LABELS[name]
                for name, enabled in filters.items()
                if enabled
            ]
            task_logger.info(
                "启用筛选项：%s",
                "、".join(enabled_filters) if enabled_filters else "无",
            )
            module = _load_screen_module()
            output_path = DATA_DIR / f"{task_id}.xlsx"
            result = module.run_screening(
                config_path=str(strategy_path),
                config_overrides=build_filter_config_overrides(filters),
                output=str(output_path),
            )
            rows = _result_rows(result)
            finished_at = datetime.now(timezone.utc)
            with get_engine().begin() as conn:
                if rows:
                    conn.execute(
                        text(
                            """
                            INSERT INTO investment_prediction_results
                                (
                                    task_id, stock_code, stock_name,
                                    stock_category, bowl_stage, sector
                                )
                            VALUES
                                (
                                    CAST(:task_id AS uuid), :stock_code, :stock_name,
                                    :stock_category, :bowl_stage, :sector
                                )
                            """
                        ),
                        [{"task_id": task_id, **row} for row in rows],
                    )
                conn.execute(
                    text(
                        """
                        UPDATE investment_prediction_tasks
                        SET finished_at = :finished_at, hit_count = :hit_count, status = 'success'
                        WHERE id = CAST(:task_id AS uuid)
                        """
                    ),
                    {
                        "task_id": task_id,
                        "finished_at": finished_at,
                        "hit_count": len(rows),
                    },
                )
            task_logger.info("任务完成，共命中 %s 只股票", len(rows))
            with self._lock:
                self._status = "success"
                self._error_message = None
        except (Exception, SystemExit) as exc:
            task_logger.exception("任务失败：%s", exc)
            try:
                with get_engine().begin() as conn:
                    conn.execute(
                        text(
                            """
                        UPDATE investment_prediction_tasks
                        SET finished_at = :finished_at, status = 'failed'
                            WHERE id = CAST(:task_id AS uuid)
                            """
                        ),
                        {
                            "task_id": task_id,
                            "finished_at": datetime.now(timezone.utc),
                        },
                    )
            finally:
                with self._lock:
                    self._status = "failed"
                    self._error_message = str(exc)
        finally:
            handler.flush()
            root_logger.removeHandler(handler)
            handler.close()
            if previous_root_level > logging.INFO:
                root_logger.setLevel(previous_root_level)


prediction_task_manager = PredictionTaskManager()
