from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.password import verify_password
from app.core.security import create_access_token, get_current_user
from app.schemas.user import CaptchaResponse, LoginRequest, LoginResponse, UserPublic
from app.services.login_guard_service import (
    MAX_LOGIN_FAILURES,
    clear_login_failures,
    create_captcha,
    get_lock_remaining_seconds,
    register_login_failure,
    verify_captcha,
)
from app.services.user_service import get_user_by_identifier

router = APIRouter(tags=["auth"])


@router.get("/auth/captcha", response_model=CaptchaResponse)
def get_captcha() -> CaptchaResponse:
    captcha_id, image_data, expires_in_seconds = create_captcha()
    return {
        "captcha_id": captcha_id,
        "image_data": image_data,
        "expires_in_seconds": expires_in_seconds,
    }


@router.post("/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> LoginResponse:
    lock_remaining_seconds = get_lock_remaining_seconds(payload.identifier)
    if lock_remaining_seconds > 0:
        minutes = (lock_remaining_seconds + 59) // 60
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"登录失败次数过多，请 {minutes} 分钟后再试"
        )

    if not verify_captcha(payload.captcha_id, payload.captcha_answer):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码错误或已过期，请刷新后重试"
        )

    # 按邮箱登录，大小写不敏感。
    user = get_user_by_identifier(db, payload.identifier)
    if not user or not verify_password(payload.password, user["password_hash"]):
        lock_for_seconds = register_login_failure(payload.identifier)
        if lock_for_seconds > 0:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="登录失败超过 5 次，已锁定 10 分钟"
            )

        state_hint = f"账号或密码不正确（连续失败满 {MAX_LOGIN_FAILURES} 次将锁定 10 分钟）"
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=state_hint
        )

    clear_login_failures(payload.identifier)
    token = create_access_token(user["id"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": str(user["id"]),
            "username": user["username"],
            "email": user["email"],
            "role_group": user["role_group"]
        }
    }


@router.get("/me", response_model=UserPublic)
def me(current_user: dict = Depends(get_current_user)) -> UserPublic:
    # 返回当前登录用户信息。
    return {
        "id": str(current_user["id"]),
        "username": current_user["username"],
        "email": current_user["email"],
        "role_group": current_user["role_group"]
    }
