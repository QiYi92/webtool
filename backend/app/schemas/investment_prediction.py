from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


PredictionStatus = Literal["idle", "running", "success", "failed"]
PredictionTaskType = Literal["manual", "scheduled"]


class PredictionFilterSettings(BaseModel):
    exclude_gem: bool = True
    exclude_star_market: bool = True
    exclude_insufficient_listing: bool = True
    exclude_failed_year_trend: bool = True
    exclude_insufficient_kline: bool = True
    exclude_failed_volume: bool = True
    exclude_failed_bowl: bool = True


class PredictionRunRequest(BaseModel):
    strategy: str = Field(min_length=1, max_length=100)
    filters: PredictionFilterSettings = Field(
        default_factory=PredictionFilterSettings
    )


class PredictionTaskRecord(BaseModel):
    id: str
    started_at: datetime
    finished_at: datetime | None = None
    hit_count: int
    task_type: PredictionTaskType = "manual"
    status: PredictionStatus = "failed"


class PredictionTaskListResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[PredictionTaskRecord]


class PredictionTasksDeleteRequest(BaseModel):
    task_ids: list[str] = Field(min_length=1, max_length=50)


class PredictionTasksDeleteResponse(BaseModel):
    deleted_count: int
    deleted_task_ids: list[str]


class PredictionStatusResponse(BaseModel):
    status: PredictionStatus
    task: PredictionTaskRecord | None = None
    strategy: str | None = None
    error_message: str | None = None


class PredictionRunResponse(BaseModel):
    ok: bool
    task_id: str
    message: str


class PredictionStrategiesResponse(BaseModel):
    items: list[str]
    default_strategy: str | None = None


class PredictionLogResponse(BaseModel):
    task_id: str
    content: str
    truncated: bool
    total_bytes: int


class PredictionResultRecord(BaseModel):
    stock_code: str
    stock_name: str
    stock_category: str
    bowl_stage: str
    sector: str


class PredictionResultsResponse(BaseModel):
    task_id: str
    items: list[PredictionResultRecord]


class PredictionScheduleSettings(BaseModel):
    enabled: bool = False
    hour: int = Field(default=9, ge=0, le=23)
    minute: int = Field(default=0, ge=0, le=59)
