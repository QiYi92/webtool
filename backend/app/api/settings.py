from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.password import get_password_hash, verify_password
from app.core.security import get_current_user
from app.schemas.user import OkResponse, UpdateAccountRequest, UpdatePasswordRequest, UserPublic
from app.services.user_service import get_user_with_password, update_user_account, update_user_password

router = APIRouter(prefix="/settings", tags=["settings"])


@router.put("/account", response_model=UserPublic)
def update_account(
    payload: UpdateAccountRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserPublic:
    # 更新账号信息（用户名/邮箱）。
    try:
        user = update_user_account(db, current_user["id"], payload.username, payload.email)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="用户名或邮箱已存在"
        ) from exc

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    return {
        "id": str(user["id"]),
        "username": user["username"],
        "email": user["email"],
        "role_group": user["role_group"]
    }


@router.put("/password", response_model=OkResponse)
def update_password(
    payload: UpdatePasswordRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OkResponse:
    # 更新密码，包含旧密码校验与二次确认。
    if payload.new_password != payload.new_password_confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password confirmation does not match"
        )

    user = get_user_with_password(db, current_user["id"])
    if not user or not verify_password(payload.old_password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Old password is incorrect"
        )

    new_hash = get_password_hash(payload.new_password)
    update_user_password(db, current_user["id"], new_hash)

    return {"ok": True}
