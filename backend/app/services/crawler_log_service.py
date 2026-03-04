from pathlib import Path

from app.services.anime_crawler.db import fetch_all, fetch_one, get_conn

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = Path(__file__).resolve().parents[2]
LOGS_ROOT = BACKEND_ROOT / "logs"
MAX_TAIL_BYTES = 20 * 1024


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

    # 支持 "backend/logs/..." 与 "logs/..." 两种相对路径
    if path_obj.is_absolute():
        candidate = path_obj.resolve()
    elif log_path.startswith("backend/"):
        candidate = (REPO_ROOT / path_obj).resolve()
    else:
        candidate = (BACKEND_ROOT / path_obj).resolve()

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
        return "", False, 0, "log_path 非法，仅允许读取 backend/logs 目录"

    if not safe_path.exists():
        return "", False, 0, f"日志文件不存在: {safe_path}"
    if not safe_path.is_file():
        return "", False, 0, f"日志路径不是文件: {safe_path}"

    total_bytes = safe_path.stat().st_size
    read_size = min(max_bytes, total_bytes)
    truncated = total_bytes > read_size

    with safe_path.open("rb") as file_obj:
        if truncated:
            file_obj.seek(-read_size, 2)
        content = file_obj.read(read_size).decode("utf-8", errors="ignore")

    return content, truncated, total_bytes, None
