from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy.exc import SQLAlchemyError

from app.core.security import get_current_user
from app.schemas.investment_prediction import (
    PredictionLogResponse,
    PredictionResultsResponse,
    PredictionRunRequest,
    PredictionRunResponse,
    PredictionScheduleSettings,
    PredictionStatusResponse,
    PredictionStrategiesResponse,
    PredictionTaskListResponse,
    PredictionTasksDeleteRequest,
    PredictionTasksDeleteResponse,
)
from app.services.investment_prediction_service import (
    delete_task_artifacts,
    delete_tasks,
    get_results,
    get_report_path,
    get_schedule_settings,
    get_task,
    list_tasks,
    list_strategies,
    prediction_task_manager,
    read_task_log,
    save_schedule_settings,
)
from app.services.investment_prediction_scheduler import refresh_prediction_schedule


router = APIRouter(
    prefix="/tools/investment-prediction",
    tags=["investment-prediction"],
)


@router.get("/strategies", response_model=PredictionStrategiesResponse)
def get_strategies(
    current_user: dict = Depends(get_current_user),
) -> PredictionStrategiesResponse:
    del current_user
    try:
        items = list_strategies()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    default_strategy = "default_bowl_v2" if "default_bowl_v2" in items else (items[0] if items else None)
    return PredictionStrategiesResponse(
        items=items,
        default_strategy=default_strategy,
    )


@router.post("/run", response_model=PredictionRunResponse)
def run_prediction(
    payload: PredictionRunRequest,
    current_user: dict = Depends(get_current_user),
) -> PredictionRunResponse:
    del current_user
    try:
        task_id = prediction_task_manager.start(
            payload.strategy,
            payload.filters.model_dump(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="投资预测数据表尚未创建或数据库暂不可用",
        ) from exc
    return PredictionRunResponse(
        ok=True,
        task_id=task_id,
        message="投资走势预测任务已启动",
    )


@router.get("/status", response_model=PredictionStatusResponse)
def get_prediction_status(
    current_user: dict = Depends(get_current_user),
) -> PredictionStatusResponse:
    del current_user
    try:
        return PredictionStatusResponse(**prediction_task_manager.snapshot())
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="投资预测数据表尚未创建或数据库暂不可用",
        ) from exc


@router.get("/schedule", response_model=PredictionScheduleSettings)
def get_prediction_schedule(
    current_user: dict = Depends(get_current_user),
) -> PredictionScheduleSettings:
    del current_user
    try:
        return PredictionScheduleSettings(**get_schedule_settings())
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="定时预测设置暂不可用，请先执行数据库迁移",
        ) from exc


@router.put("/schedule", response_model=PredictionScheduleSettings)
def update_prediction_schedule(
    payload: PredictionScheduleSettings,
    current_user: dict = Depends(get_current_user),
) -> PredictionScheduleSettings:
    del current_user
    try:
        settings = save_schedule_settings(
            payload.enabled, payload.hour, payload.minute
        )
        refresh_prediction_schedule()
        return PredictionScheduleSettings(**settings)
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="定时预测设置保存失败，请先执行数据库迁移",
        ) from exc


@router.get("/tasks", response_model=PredictionTaskListResponse)
def get_prediction_tasks(
    page: int = Query(1, ge=1),
    page_size: int = Query(15, ge=1, le=50),
    current_user: dict = Depends(get_current_user),
) -> PredictionTaskListResponse:
    del current_user
    try:
        total, items = list_tasks(page=page, page_size=page_size)
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="投资预测数据库暂不可用",
        ) from exc
    return PredictionTaskListResponse(
        total=total,
        page=page,
        page_size=page_size,
        items=items,
    )


@router.delete("/tasks", response_model=PredictionTasksDeleteResponse)
def delete_prediction_tasks(
    payload: PredictionTasksDeleteRequest,
    current_user: dict = Depends(get_current_user),
) -> PredictionTasksDeleteResponse:
    del current_user
    try:
        task_ids = list(
            dict.fromkeys(str(UUID(task_id)) for task_id in payload.task_ids)
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="任务 ID 格式不正确") from exc

    running_task_id = prediction_task_manager.get_running_task_id()
    if running_task_id and running_task_id in task_ids:
        raise HTTPException(status_code=409, detail="运行中的预测任务不能删除")
    try:
        deleted_task_ids = delete_tasks(task_ids)
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="投资预测数据库暂不可用",
        ) from exc

    prediction_task_manager.forget_deleted_tasks(deleted_task_ids)
    delete_task_artifacts(deleted_task_ids)
    return PredictionTasksDeleteResponse(
        deleted_count=len(deleted_task_ids),
        deleted_task_ids=deleted_task_ids,
    )


@router.get("/tasks/{task_id}/log", response_model=PredictionLogResponse)
def get_prediction_log(
    task_id: str,
    current_user: dict = Depends(get_current_user),
) -> PredictionLogResponse:
    del current_user
    try:
        task = get_task(task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="任务不存在")
        content, truncated, total_bytes = read_task_log(task_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="任务 ID 格式不正确") from exc
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="投资预测数据库暂不可用",
        ) from exc
    return PredictionLogResponse(
        task_id=task_id,
        content=content,
        truncated=truncated,
        total_bytes=total_bytes,
    )


@router.get("/tasks/{task_id}/results", response_model=PredictionResultsResponse)
def get_prediction_results(
    task_id: str,
    current_user: dict = Depends(get_current_user),
) -> PredictionResultsResponse:
    del current_user
    try:
        if get_task(task_id) is None:
            raise HTTPException(status_code=404, detail="任务不存在")
        items = get_results(task_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="任务 ID 格式不正确") from exc
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="投资预测数据库暂不可用",
        ) from exc
    return PredictionResultsResponse(task_id=task_id, items=items)


@router.get("/tasks/{task_id}/report")
def download_prediction_report(
    task_id: str,
    current_user: dict = Depends(get_current_user),
) -> FileResponse:
    """Download the original Excel report generated by Stock_Screen_demo."""
    del current_user
    try:
        if get_task(task_id) is None:
            raise HTTPException(status_code=404, detail="任务不存在")
        report_path = get_report_path(task_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="任务 ID 格式不正确") from exc
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="投资预测数据库暂不可用",
        ) from exc

    if not report_path.is_file():
        raise HTTPException(status_code=404, detail="该历史任务的 Excel 报告不存在")

    return FileResponse(
        report_path,
        media_type=(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ),
        filename=f"investment_prediction_{task_id}.xlsx",
    )
