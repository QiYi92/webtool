from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import DATABASE_URL


def get_engine() -> Engine:
    # 在应用启动或首次访问时创建连接引擎。
    if not DATABASE_URL:
        raise ValueError("DATABASE_URL is not set")
    return create_engine(DATABASE_URL, pool_pre_ping=True)


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=get_engine())


def get_db_session() -> Session:
    # 提供同步会话，方便后续依赖注入扩展。
    return SessionLocal()


def get_db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
