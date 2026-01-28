from fastapi import APIRouter, HTTPException, status
from sqlalchemy import text

from app.core.db import get_engine

router = APIRouter()


@router.get("/health")
def health_check() -> dict:
    # 基础健康检查。
    return {"status": "ok"}


@router.get("/health/db")
def health_db() -> dict:
    # 数据库连通性检查（不依赖任何表）。
    try:
        engine = get_engine()
        with engine.connect() as connection:
            connection.execute(text("select 1"))
        return {"database": "ok"}
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(exc)
        ) from exc
