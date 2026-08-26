"""Trusted bootstrap endpoint used by the host tool station."""

from __future__ import annotations

import os

import jwt
from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import RedirectResponse

from api.v1.endpoints.auth import _set_session_cookie
from src.auth import create_session


router = APIRouter()


@router.get("/sso/launch", include_in_schema=False)
async def launch_from_tool_station(ticket: str, request: Request):
    secret = os.getenv("DSA_SSO_SECRET", "")
    if len(secret) < 32:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="DSA SSO 密钥尚未安全配置")
    try:
        jwt.decode(
            ticket,
            secret,
            algorithms=[os.getenv("DSA_SSO_ALGORITHM", "HS256")],
            audience="dsa",
            issuer="galileocat-webtool",
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="DSA 登录票据无效") from exc

    session = create_session()
    if not session:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="DSA 会话不可用")
    root_path = os.getenv("DSA_ROOT_PATH", "/dsa").rstrip("/") or "/dsa"
    response = RedirectResponse(url=f"{root_path}/", status_code=status.HTTP_303_SEE_OTHER)
    _set_session_cookie(response, session, request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response
