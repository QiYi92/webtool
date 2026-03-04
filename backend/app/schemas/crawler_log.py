from datetime import datetime
from typing import Literal

from pydantic import BaseModel


CrawlerRunType = Literal["manual", "scheduled", "autostart"]
CrawlerRunStatus = Literal["running", "success", "failed", "interrupted"]


class CrawlerLogRecord(BaseModel):
    id: str
    crawler_name: str
    run_type: CrawlerRunType
    status: CrawlerRunStatus
    started_at: datetime | None = None
    finished_at: datetime | None = None
    duration_ms: int | None = None
    command: str | None = None
    summary: str | None = None
    error_message: str | None = None
    log_path: str


class CrawlerLatestLogResponse(BaseModel):
    record: CrawlerLogRecord | None = None
    content: str
    truncated: bool
    total_bytes: int
    warning: str | None = None


class CrawlerLogListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[CrawlerLogRecord]
