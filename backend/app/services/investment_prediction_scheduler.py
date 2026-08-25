import logging
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.services.investment_prediction_service import (
    DEFAULT_FILTER_SETTINGS,
    get_schedule_settings,
    list_strategies,
    prediction_task_manager,
)


SCHEDULE_JOB_ID = "investment-prediction-daily"
SCHEDULE_TIMEZONE = ZoneInfo("Asia/Shanghai")
_scheduler: BackgroundScheduler | None = None


def _default_strategy() -> str | None:
    strategies = list_strategies()
    if "default_bowl_v2" in strategies:
        return "default_bowl_v2"
    return strategies[0] if strategies else None


def run_scheduled_prediction() -> None:
    try:
        settings = get_schedule_settings()
        if not settings["enabled"]:
            return
        strategy = _default_strategy()
        if not strategy:
            logging.error("定时投资预测未执行：没有可用策略")
            return
        prediction_task_manager.start(
            strategy,
            DEFAULT_FILTER_SETTINGS,
            task_type="scheduled",
        )
        logging.info("已启动定时投资预测，策略：%s", strategy)
    except RuntimeError as exc:
        logging.warning("跳过定时投资预测：%s", exc)
    except Exception:
        logging.exception("定时投资预测启动失败")


def refresh_prediction_schedule() -> None:
    if _scheduler is None:
        return
    settings = get_schedule_settings()
    _scheduler.add_job(
        run_scheduled_prediction,
        CronTrigger(
            hour=settings["hour"],
            minute=settings["minute"],
            timezone=SCHEDULE_TIMEZONE,
        ),
        id=SCHEDULE_JOB_ID,
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )


def start_prediction_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = BackgroundScheduler(timezone=SCHEDULE_TIMEZONE)
    _scheduler.start()
    try:
        refresh_prediction_schedule()
    except Exception:
        logging.exception("加载定时投资预测设置失败")


def shutdown_prediction_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
