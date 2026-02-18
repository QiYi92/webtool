from fastapi import APIRouter, Depends, Query, status
from fastapi.exceptions import HTTPException

from app.core.security import get_current_user
from app.schemas.crawler_log import (
    CrawlerLatestLogResponse,
    CrawlerLogListResponse,
    CrawlerLogRecord,
)
from app.services.crawler_log_service import (
    get_log_record_by_id,
    get_latest_log_record,
    list_log_records,
    read_log_tail,
)

router = APIRouter(prefix="/tools/anime-crawler", tags=["anime-crawler"])


def _ensure_admin(current_user: dict) -> None:
    if current_user.get("role_group") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden",
        )


@router.get("/logs/latest", response_model=CrawlerLatestLogResponse)
def get_latest_log(
    crawler_name: str = Query("anime_guide"),
    current_user: dict = Depends(get_current_user),
) -> CrawlerLatestLogResponse:
    _ensure_admin(current_user)
    record = get_latest_log_record(crawler_name)
    if not record:
        return CrawlerLatestLogResponse(
            record=None,
            content="",
            truncated=False,
            total_bytes=0,
            warning="暂无日志记录",
        )

    content, truncated, total_bytes, warning = read_log_tail(record["log_path"])
    return CrawlerLatestLogResponse(
        record=CrawlerLogRecord(**record),
        content=content,
        truncated=truncated,
        total_bytes=total_bytes,
        warning=warning,
    )


@router.get("/logs", response_model=CrawlerLogListResponse)
def get_log_list(
    crawler_name: str = Query("anime_guide"),
    page: int = Query(1, ge=1),
    page_size: int = Query(15, ge=1, le=50),
    current_user: dict = Depends(get_current_user),
) -> CrawlerLogListResponse:
    _ensure_admin(current_user)
    total, rows = list_log_records(crawler_name=crawler_name, page=page, page_size=page_size)
    return CrawlerLogListResponse(
        total=total,
        page=page,
        page_size=page_size,
        items=[CrawlerLogRecord(**row) for row in rows],
    )


@router.get("/logs/{log_id}/tail", response_model=CrawlerLatestLogResponse)
def get_log_tail_by_id(
    log_id: str,
    crawler_name: str = Query("anime_guide"),
    current_user: dict = Depends(get_current_user),
) -> CrawlerLatestLogResponse:
    _ensure_admin(current_user)
    record = get_log_record_by_id(log_id=log_id, crawler_name=crawler_name)
    if not record:
        raise HTTPException(status_code=404, detail="Log not found")

    content, truncated, total_bytes, warning = read_log_tail(record["log_path"])
    return CrawlerLatestLogResponse(
        record=CrawlerLogRecord(**record),
        content=content,
        truncated=truncated,
        total_bytes=total_bytes,
        warning=warning,
    )
