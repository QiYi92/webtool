import logging
from threading import Thread
from datetime import date, timedelta
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from .calendar import crawl_bangumi_calendar
from .episode import crawl_bangumi_episodes
from .subject import crawl_bangumi_subject
from .db import get_conn, fetch_one

logger = logging.getLogger(__name__)

_scheduler: Optional[BackgroundScheduler] = None


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


def _should_crawl_episodes(subject_id: int) -> bool:
    with get_conn() as conn:
        row = fetch_one(
            conn,
            "SELECT id FROM anime WHERE bgm_subject_id = :sid LIMIT 1",
            {"sid": subject_id},
        )
        if not row:
            return True
        anime_id = row["id"]
        count_row = fetch_one(
            conn,
            "SELECT COUNT(1) AS cnt FROM anime_episode WHERE anime_id = :aid",
            {"aid": anime_id},
        )
        if not count_row or count_row.get("cnt", 0) == 0:
            return True

        today = date.today()
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
        return not cal_row or cal_row.get("cnt", 0) == 0


def run_crawler_once() -> None:
    logger.info("【调度】开始执行一次爬取任务")
    try:
        subject_ids = crawl_bangumi_calendar()
    except Exception as exc:
        logger.exception("【调度】日历爬取失败：%s", exc)
        return

    for sid in subject_ids:
        try:
            if _should_crawl_detail(sid):
                crawl_bangumi_subject(sid)
            if _should_crawl_episodes(sid):
                crawl_bangumi_episodes(sid)
        except Exception as exc:
            logger.exception("【调度】处理 subject_id=%s 失败：%s", sid, exc)
    logger.info("【调度】本次爬取任务结束")


def start_crawler_scheduler() -> None:
    global _scheduler
    if _scheduler:
        return
    scheduler = BackgroundScheduler()
    scheduler.add_job(run_crawler_once, CronTrigger(hour=9, minute=0))
    scheduler.add_job(run_crawler_once, CronTrigger(hour=21, minute=0))
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
    Thread(target=run_crawler_once, daemon=True).start()
