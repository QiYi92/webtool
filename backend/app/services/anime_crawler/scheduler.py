import logging
from collections import Counter
from threading import Thread
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Literal, Optional, Tuple

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import text

from .calendar import crawl_bangumi_calendar
from .episode import crawl_bangumi_episodes
from .subject import crawl_bangumi_subject
from .db import get_conn, fetch_one

logger = logging.getLogger(__name__)

_scheduler: Optional[BackgroundScheduler] = None
BACKEND_ROOT = Path(__file__).resolve().parents[3]
RUN_LOG_DIR = BACKEND_ROOT / "logs" / "anime_crawler"
RUN_LOG_PATH_PREFIX = "backend/logs/anime_crawler"
CrawlerRunType = Literal["manual", "scheduled", "autostart"]
SKIP_REASON_LABELS: dict[str, str] = {
    "already_crawled_today": "今日已抓取",
    "outside_update_window": "不在更新窗口",
    "unknown_weekday_cooldown": "未知更新日冷却中",
    "episode_known_this_week": "本周集数已存在",
    "anime_not_found": "番剧记录不存在",
    "no_episode_data": "无历史集数数据",
}


def _ensure_run_log_dir() -> None:
    RUN_LOG_DIR.mkdir(parents=True, exist_ok=True)


def _build_run_log_path(started_at: datetime) -> tuple[str, Path]:
    filename = started_at.strftime("%Y-%m-%d_%H%M%S_%f") + ".txt"
    return f"{RUN_LOG_PATH_PREFIX}/{filename}", RUN_LOG_DIR / filename


def _build_default_command(run_type: CrawlerRunType) -> str:
    command_map = {
        "manual": "manual: run_crawler_once",
        "scheduled": "apscheduler: run_crawler_once",
        "autostart": "startup_thread: run_crawler_once",
    }
    return command_map[run_type]


def _attach_run_file_handler(log_file: Path) -> logging.Handler:
    handler = logging.FileHandler(log_file, encoding="utf-8")
    handler.setLevel(logging.INFO)
    handler.setFormatter(
        logging.Formatter("%(asctime)s | %(levelname)s | %(name)s | %(message)s")
    )
    # 仅采集爬虫模块日志，避免 uvicorn 访问日志混入
    crawler_root_logger = logging.getLogger("app.services.anime_crawler")
    crawler_root_logger.addHandler(handler)
    return handler


def _format_skip_reason_counter(counter: Counter[str]) -> str:
    if not counter:
        return "无"
    parts: list[str] = []
    for key, count in counter.items():
        label = SKIP_REASON_LABELS.get(key, key)
        parts.append(f"{label}:{count}")
    return "，".join(parts)


def _insert_run_log_row(
    *,
    log_path: str,
    run_type: CrawlerRunType,
    command: str | None,
    started_at: datetime,
) -> str | None:
    try:
        with get_conn() as conn:
            row = fetch_one(
                conn,
                "INSERT INTO crawler_run_logs (\n"
                "    log_path, run_type, crawler_name, status, started_at, command\n"
                ") VALUES (\n"
                "    :log_path, :run_type, :crawler_name, :status, :started_at, :command\n"
                ")\n"
                "RETURNING id::text AS id",
                {
                    "log_path": log_path,
                    "run_type": run_type,
                    "crawler_name": "anime_guide",
                    "status": "running",
                    "started_at": started_at.isoformat(),
                    "command": command or _build_default_command(run_type),
                },
            )
        return row.get("id") if row else None
    except Exception as exc:
        logger.exception("【调度】写入 crawler_run_logs 失败（start）：%s", exc)
        return None


def _update_run_log_row(
    *,
    run_id: str | None,
    status: Literal["success", "failed"],
    finished_at: datetime,
    duration_ms: int,
    summary: str,
    error_message: str | None,
) -> None:
    if not run_id:
        return
    try:
        with get_conn() as conn:
            conn.execute(
                text(
                    "UPDATE crawler_run_logs\n"
                    "SET\n"
                    "    status = :status,\n"
                    "    finished_at = :finished_at,\n"
                    "    duration_ms = :duration_ms,\n"
                    "    summary = :summary,\n"
                    "    error_message = :error_message\n"
                    "WHERE id = CAST(:id AS uuid)"
                ),
                {
                    "id": run_id,
                    "status": status,
                    "finished_at": finished_at.isoformat(),
                    "duration_ms": duration_ms,
                    "summary": summary,
                    "error_message": error_message,
                },
            )
    except Exception as exc:
        logger.exception("【调度】写入 crawler_run_logs 失败（finish）：%s", exc)


def _should_crawl_detail(subject_id: int, threshold_days: int = 7) -> bool:
    with get_conn() as conn:
        row = fetch_one(
            conn,
            "SELECT last_crawled_at FROM anime WHERE bgm_subject_id = :sid LIMIT 1",
            {"sid": subject_id},
        )
    if not row or not row.get("last_crawled_at"):
        return True

    from datetime import datetime

    last = row["last_crawled_at"]
    if isinstance(last, str):
        try:
            last = datetime.fromisoformat(last.replace("Z", "+00:00"))
        except Exception:
            return True
    delta = datetime.now(last.tzinfo) - last
    return delta.days >= threshold_days


def _should_crawl_episodes(subject_id: int) -> Tuple[bool, str]:
    with get_conn() as conn:
        row = fetch_one(
            conn,
            "SELECT id, weekday FROM anime WHERE bgm_subject_id = :sid LIMIT 1",
            {"sid": subject_id},
        )
        if not row:
            return True, "anime_not_found"
        anime_id = row["id"]
        weekday = row.get("weekday")
        count_row = fetch_one(
            conn,
            "SELECT COUNT(1) AS cnt FROM anime_episode WHERE anime_id = :aid",
            {"aid": anime_id},
        )
        if not count_row or count_row.get("cnt", 0) == 0:
            return True, "no_episode_data"

        latest_row = fetch_one(
            conn,
            "SELECT MAX(updated_at) AS last_updated_at FROM anime_episode WHERE anime_id = :aid",
            {"aid": anime_id},
        )
        last_updated_at = latest_row.get("last_updated_at") if latest_row else None
        if isinstance(last_updated_at, str):
            try:
                last_updated_at = datetime.fromisoformat(last_updated_at.replace("Z", "+00:00"))
            except Exception:
                last_updated_at = None
        if isinstance(last_updated_at, datetime):
            now = datetime.now(last_updated_at.tzinfo) if last_updated_at.tzinfo else datetime.now()
            # 09:00 / 21:00 两次调度避免同日重复抓取同一番剧
            if now.date() == last_updated_at.date():
                return False, "already_crawled_today"

        today = date.today()
        today_weekday = (today.weekday() + 1) % 7
        if isinstance(weekday, int):
            # Bangumi 周更为主：默认只在更新日当天和次日窗口抓取
            allowed_weekdays = {today_weekday, (today_weekday - 1) % 7}
            if weekday not in allowed_weekdays:
                return False, "outside_update_window"
        elif isinstance(last_updated_at, datetime):
            now = datetime.now(last_updated_at.tzinfo) if last_updated_at.tzinfo else datetime.now()
            # 未识别 weekday 时，至少间隔 3 天再补抓
            if (now - last_updated_at).days < 3:
                return False, "unknown_weekday_cooldown"

        sunday_offset = (today.weekday() + 1) % 7
        week_start = today - timedelta(days=sunday_offset)
        week_end = week_start + timedelta(days=6)
        cal_row = fetch_one(
            conn,
            "SELECT COUNT(1) AS cnt FROM anime_airing_calendar "
            "WHERE anime_id = :aid AND episode_no IS NOT NULL "
            "AND air_date BETWEEN :start AND :end",
            {"aid": anime_id, "start": week_start.isoformat(), "end": week_end.isoformat()},
        )
        if cal_row and cal_row.get("cnt", 0) > 0:
            return False, "episode_known_this_week"
        return True, "need_refresh"


def run_crawler_once(
    run_type: CrawlerRunType = "scheduled", command: str | None = None
) -> None:
    started_at = datetime.now(timezone.utc)
    _ensure_run_log_dir()
    log_path, log_file = _build_run_log_path(started_at)
    file_handler = _attach_run_file_handler(log_file)
    run_id = _insert_run_log_row(
        log_path=log_path,
        run_type=run_type,
        command=command,
        started_at=started_at,
    )

    subject_ids: list[int] = []
    detail_crawled = 0
    detail_skipped = 0
    episode_crawled = 0
    episode_skipped = 0
    subject_failed = 0
    skip_reason_counter: Counter[str] = Counter()
    errors: list[str] = []
    run_failed = False

    logger.info(
        "【调度】开始执行一次爬取任务 run_type=%s log_path=%s run_id=%s",
        run_type,
        log_path,
        run_id or "N/A",
    )
    try:
        try:
            subject_ids = crawl_bangumi_calendar()
        except Exception as exc:
            run_failed = True
            errors.append(f"calendar_failed: {exc}")
            logger.exception("【调度】日历爬取失败：%s", exc)
            subject_ids = []

        for sid in subject_ids:
            try:
                if _should_crawl_detail(sid):
                    crawl_bangumi_subject(sid)
                    detail_crawled += 1
                else:
                    detail_skipped += 1

                should_crawl_episodes, reason = _should_crawl_episodes(sid)
                if should_crawl_episodes:
                    crawl_bangumi_episodes(sid)
                    episode_crawled += 1
                else:
                    episode_skipped += 1
                    skip_reason_counter[reason] += 1
                    logger.info("【章节】跳过：subject_id=%s reason=%s", sid, reason)
            except Exception as exc:
                run_failed = True
                subject_failed += 1
                if len(errors) < 5:
                    errors.append(f"subject_id={sid}: {exc}")
                logger.exception("【调度】处理 subject_id=%s 失败：%s", sid, exc)
    finally:
        finished_at = datetime.now(timezone.utc)
        duration_ms = max(
            int((finished_at - started_at).total_seconds() * 1000),
            0,
        )
        status: Literal["success", "failed"] = (
            "failed" if run_failed or subject_failed > 0 else "success"
        )
        status_cn = "失败" if status == "failed" else "成功"
        skip_reason_text = _format_skip_reason_counter(skip_reason_counter)
        summary = (
            f"番剧总数={len(subject_ids)}；"
            f"详情抓取={detail_crawled}，详情跳过={detail_skipped}；"
            f"章节抓取={episode_crawled}，章节跳过={episode_skipped}；"
            f"处理失败={subject_failed}；"
            f"章节跳过原因={skip_reason_text}"
        )
        error_message = "; ".join(errors) if errors else None

        _update_run_log_row(
            run_id=run_id,
            status=status,
            finished_at=finished_at,
            duration_ms=duration_ms,
            summary=summary,
            error_message=error_message,
        )
        logger.info(
            "【调度】本次爬取任务结束：状态=%s，耗时=%sms，%s",
            status_cn,
            duration_ms,
            summary,
        )
        crawler_root_logger = logging.getLogger("app.services.anime_crawler")
        crawler_root_logger.removeHandler(file_handler)
        file_handler.close()


def start_crawler_scheduler() -> None:
    global _scheduler
    if _scheduler:
        return
    scheduler = BackgroundScheduler()
    scheduler.add_job(
        run_crawler_once,
        CronTrigger(hour=9, minute=0),
        kwargs={"run_type": "scheduled", "command": "apscheduler: 09:00"},
    )
    scheduler.add_job(
        run_crawler_once,
        CronTrigger(hour=21, minute=0),
        kwargs={"run_type": "scheduled", "command": "apscheduler: 21:00"},
    )
    scheduler.start()
    _scheduler = scheduler
    logger.info("【调度】已启动定时任务（09:00 / 21:00）")


def shutdown_crawler_scheduler() -> None:
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("【调度】已停止定时任务")


def start_on_startup() -> None:
    start_crawler_scheduler()
    Thread(
        target=run_crawler_once,
        kwargs={
            "run_type": "autostart",
            "command": "fastapi_startup: start_on_startup",
        },
        daemon=True,
    ).start()
