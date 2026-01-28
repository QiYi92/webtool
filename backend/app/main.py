import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.admin_users import router as admin_users_router
from app.api.anime_guide import router as anime_guide_router
from app.api.health import router as health_router
from app.api.settings import router as settings_router
from app.api.tools import router as tools_router
from app.services.anime_crawler.scheduler import shutdown_crawler_scheduler, start_on_startup

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)

app = FastAPI(title="galileocat-webtool")

# 允许本地前端访问后端接口。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 统一注册路由，便于后续拆分模块。
app.include_router(health_router)
app.include_router(auth_router)
app.include_router(admin_users_router)
app.include_router(settings_router)
app.include_router(tools_router, prefix="/tools", tags=["tools"])
app.include_router(anime_guide_router)


@app.on_event("startup")
def on_startup() -> None:
    start_on_startup()


@app.on_event("shutdown")
def on_shutdown() -> None:
    shutdown_crawler_scheduler()
