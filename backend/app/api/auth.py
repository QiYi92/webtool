from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.password import verify_password
from app.core.security import create_access_token, get_current_user
from app.schemas.user import LoginRequest, LoginResponse, UserPublic
from app.services.user_service import get_user_by_identifier

router = APIRouter(tags=["auth"])


@router.post("/auth/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> LoginResponse:
    # 按邮箱登录，大小写不敏感。
    user = get_user_by_identifier(db, payload.identifier)
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials"
        )

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
