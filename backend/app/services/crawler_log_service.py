from pathlib import Path

from app.services.anime_crawler.db import fetch_all, fetch_one, get_conn


def _detect_backend_root() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        if parent.name == "app":
            return parent.parent
    raise RuntimeError("Cannot locate backend root from current file path")


BACKEND_ROOT = _detect_backend_root()
LOGS_ROOT = BACKEND_ROOT / "logs"
MAX_TAIL_BYTES = 20 * 1024
MISSING_LOG_WARNING = "日志文件不在本地或已清理"


def get_latest_log_record(crawler_name: str = "anime_guide") -> dict | None:
    with get_conn() as conn:
        return fetch_one(
            conn,
            """
            SELECT
                id::text AS id,
                crawler_name,
                run_type,
                (
                    CASE
                        WHEN status::text = 'running'
                             AND finished_at IS NULL
                             AND started_at < (
                                SELECT MAX(started_at)
                                FROM crawler_run_logs
                                WHERE crawler_name = :crawler_name
                             )
                        THEN 'interrupted'
                        ELSE status::text
                    END
                ) AS status,
                started_at,
                finished_at,
                duration_ms,
                command,
                summary,
                error_message,
                log_path
            FROM crawler_run_logs
            WHERE crawler_name = :crawler_name
            ORDER BY started_at DESC
            LIMIT 1;
            """,
            {"crawler_name": crawler_name},
        )


def list_log_records(
    crawler_name: str = "anime_guide", page: int = 1, page_size: int = 15
) -> tuple[int, list[dict]]:
    offset = (page - 1) * page_size
    with get_conn() as conn:
        total_row = fetch_one(
            conn,
            """
            SELECT COUNT(1) AS total
            FROM crawler_run_logs
            WHERE crawler_name = :crawler_name;
            """,
            {"crawler_name": crawler_name},
        )
        items = fetch_all(
            conn,
            """
            SELECT
                id::text AS id,
                crawler_name,
                run_type,
                (
                    CASE
                        WHEN status::text = 'running'
                             AND finished_at IS NULL
                             AND started_at < (
                                SELECT MAX(started_at)
                                FROM crawler_run_logs
                                WHERE crawler_name = :crawler_name
                             )
                        THEN 'interrupted'
                        ELSE status::text
                    END
                ) AS status,
                started_at,
                finished_at,
                duration_ms,
                command,
                summary,
                error_message,
                log_path
            FROM crawler_run_logs
            WHERE crawler_name = :crawler_name
            ORDER BY started_at DESC
            LIMIT :limit OFFSET :offset;
            """,
            {
                "crawler_name": crawler_name,
                "limit": page_size,
                "offset": offset,
            },
        )
    total = int(total_row.get("total", 0)) if total_row else 0
    return total, items


def get_log_record_by_id(log_id: str, crawler_name: str = "anime_guide") -> dict | None:
    with get_conn() as conn:
        return fetch_one(
            conn,
            """
            SELECT
                id::text AS id,
                crawler_name,
                run_type,
                (
                    CASE
                        WHEN status::text = 'running'
                             AND finished_at IS NULL
                             AND started_at < (
                                SELECT MAX(started_at)
                                FROM crawler_run_logs
                                WHERE crawler_name = :crawler_name
                             )
                        THEN 'interrupted'
                        ELSE status::text
                    END
                ) AS status,
                started_at,
                finished_at,
                duration_ms,
                command,
                summary,
                error_message,
                log_path
            FROM crawler_run_logs
            WHERE id = CAST(:id AS uuid)
              AND crawler_name = :crawler_name
            LIMIT 1;
            """,
            {"id": log_id, "crawler_name": crawler_name},
        )


def _resolve_log_file_path(log_path: str) -> Path:
    path_obj = Path(log_path)

    # 兼容旧记录：
    # - backend/logs/...
    # - logs/...
    # 并允许绝对路径，但必须落在 LOGS_ROOT 下。
    if path_obj.is_absolute():
        candidate = path_obj.resolve()
    else:
        normalized = log_path
        if normalized.startswith("backend/logs/"):
            normalized = normalized[len("backend/") :]
        candidate = (BACKEND_ROOT / normalized).resolve()

    logs_root = LOGS_ROOT.resolve()
    if candidate != logs_root and logs_root not in candidate.parents:
        raise ValueError("Invalid log path: out of backend/logs")
    return candidate


def read_log_tail(
    log_path: str,
    max_bytes: int = MAX_TAIL_BYTES,
) -> tuple[str, bool, int, str | None]:
    try:
        safe_path = _resolve_log_file_path(log_path)
    except ValueError:
        return "", False, 0, MISSING_LOG_WARNING

    if not safe_path.exists():
        return "", False, 0, MISSING_LOG_WARNING
    if not safe_path.is_file():
        return "", False, 0, MISSING_LOG_WARNING

    total_bytes = safe_path.stat().st_size
    read_size = min(max_bytes, total_bytes)
    truncated = total_bytes > read_size

    with safe_path.open("rb") as file_obj:
        if truncated:
            file_obj.seek(-read_size, 2)
        content = file_obj.read(read_size).decode("utf-8", errors="ignore")

    return content, truncated, total_bytes, None
