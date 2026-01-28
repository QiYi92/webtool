import os
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection, Engine

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is missing in environment")

_engine: Engine | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = create_engine(DATABASE_URL, pool_pre_ping=True)
    return _engine


@contextmanager
def get_conn() -> Iterator[Connection]:
    engine = get_engine()
    with engine.begin() as conn:
        yield conn


def fetch_one(conn: Connection, sql: str, params: dict) -> dict | None:
    result = conn.execute(text(sql), params).mappings().first()
    return dict(result) if result else None


def fetch_all(conn: Connection, sql: str, params: dict | None = None) -> list[dict]:
    result = conn.execute(text(sql), params or {}).mappings().all()
    return [dict(row) for row in result]
