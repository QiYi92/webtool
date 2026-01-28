from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.password import get_password_hash
from app.core.security import get_current_user
from app.schemas.admin_user import AdminUser, CreateUserRequest, UpdateUserRequest
from app.services.user_service import (
    create_user,
    delete_user,
    get_user_role,
    list_users,
    update_user,
)

router = APIRouter(prefix="/admin/users", tags=["admin"])

ALLOWED_ROLE_GROUPS = {"user", "temp"}


def _ensure_admin(current_user: dict) -> None:
    if current_user.get("role_group") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden"
        )


@router.get("", response_model=list[AdminUser])
def get_users(
    q: str | None = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[AdminUser]:
    _ensure_admin(current_user)
    return list_users(db, q)


@router.post("", response_model=AdminUser)
def create_user_item(
    payload: CreateUserRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AdminUser:
    _ensure_admin(current_user)
    if payload.role_group not in ALLOWED_ROLE_GROUPS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid role_group"
        )
    if len(payload.password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password too short"
        )

    try:
        user = create_user(
            db,
            payload.username,
            payload.email,
            get_password_hash(payload.password),
            payload.role_group
        )
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="用户名或邮箱已存在"
        ) from exc

    if not user:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create user"
        )

    return user


@router.put("/{user_id}", response_model=AdminUser)
def update_user_item(
    user_id: str,
    payload: UpdateUserRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AdminUser:
    _ensure_admin(current_user)
    role = get_user_role(db, user_id)
    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    if role == "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin user cannot be modified"
        )
    if payload.role_group not in ALLOWED_ROLE_GROUPS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid role_group"
        )

    password_hash = get_password_hash(payload.password) if payload.password else None

    try:
        user = update_user(
            db,
            user_id,
            payload.username,
            payload.email,
            payload.role_group,
            password_hash
        )
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

    return user


@router.delete("/{user_id}")
def delete_user_item(
    user_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    _ensure_admin(current_user)
    role = get_user_role(db, user_id)
    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    if role == "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin user cannot be deleted"
        )

    deleted = delete_user(db, user_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    return {"ok": True}
