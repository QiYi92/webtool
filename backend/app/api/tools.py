import fcntl
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID

import requests
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import get_current_user
from app.schemas.ai_workflow import (
    AIDifyConversationListResponse,
    AIDifyMessageListResponse,
    AIWorkflowCreateRequest,
    AIWorkflowItem,
    AIWorkflowSessionAppendRequest,
    AIWorkflowSessionAppendResponse,
    AIWorkflowSyncFromDifyRequest,
    AIWorkflowSyncFromDifyResponse,
    AIWorkflowUpdateRequest,
)

router = APIRouter()

SESSION_LOG_ROOT = Path(__file__).resolve().parents[2] / "logs" / "ai_workflow_sessions"
SAFE_FILENAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")


def _ensure_admin(current_user: dict) -> None:
    if current_user.get("role_group") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden"
        )


def _normalize_workflow_row(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "url": row["url"],
        "visible_role_groups": row.get("visible_role_groups") or [],
        "is_active": row["is_active"],
        "sort_order": row["sort_order"] if row["sort_order"] is not None else 0,
        "created_at": row["created_at"],
    }


def _normalize_workflow_row_for_sync(row: Any) -> dict[str, Any]:
    data = _normalize_workflow_row(row)
    data["dify_base_url"] = (row.get("dify_base_url") or "").strip() or None
    data["dify_api_key"] = (row.get("dify_api_key") or "").strip() or None
    data["dify_user_prefix"] = (row.get("dify_user_prefix") or "gcw").strip() or "gcw"
    data["dify_fixed_user"] = (row.get("dify_fixed_user") or "").strip() or None
    data["enable_session_sync"] = bool(row.get("enable_session_sync"))
    return data


def _is_workflow_visible(workflow: dict, role_group: str, is_admin: bool) -> bool:
    if is_admin:
        return True
    if not workflow.get("is_active"):
        return False
    groups = workflow.get("visible_role_groups") or []
    return role_group in groups


def _fetch_workflow_by_id(db: Session, workflow_id: UUID) -> dict | None:
    row = db.execute(
        text(
            """
            SELECT
                id,
                name,
                url,
                visible_role_groups,
                is_active,
                sort_order,
                created_at,
                dify_base_url,
                dify_api_key,
                dify_user_prefix,
                dify_fixed_user,
                enable_session_sync
            FROM public.ai_workflow
            WHERE id = :workflow_id
            LIMIT 1;
            """
        ),
        {"workflow_id": str(workflow_id)},
    ).mappings().first()
    return _normalize_workflow_row_for_sync(row) if row else None


def _safe_part(value: str, field: str) -> str:
    if not SAFE_FILENAME_RE.match(value):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {field}"
        )
    return value


def _resolve_dify_user(workflow: dict, current_user: dict) -> str:
    fixed_user = (workflow.get("dify_fixed_user") or "").strip()
    if fixed_user:
        return fixed_user
    current_user_id = str(current_user.get("id") or current_user.get("username") or "unknown")
    return f"{workflow['dify_user_prefix']}:{current_user_id}"


def _build_session_file_path(workflow_id: UUID, session_id: str, user_identifier: str) -> Path:
    safe_session_id = _safe_part(session_id, "session_id")
    safe_workflow_id = _safe_part(str(workflow_id), "workflow_id")
    user_dir = SESSION_LOG_ROOT / user_identifier
    user_dir.mkdir(parents=True, exist_ok=True)
    return user_dir / f"{safe_workflow_id}_{safe_session_id}.json"


@router.get("/")
def list_tools(current_user: dict = Depends(get_current_user)) -> dict:
    return {
        "user_id": current_user["id"],
        "tools": [
            {"id": "example", "name": "Example Tool", "status": "placeholder"}
        ]
    }


@router.get("/ai-workflows", response_model=list[AIWorkflowItem])
def list_ai_workflows(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[AIWorkflowItem]:
    is_admin = current_user.get("role_group") == "admin"
    role_group = current_user.get("role_group", "")

    if is_admin:
        sql = """
            SELECT
                id,
                name,
                url,
                visible_role_groups,
                is_active,
                sort_order,
                created_at,
                dify_base_url,
                dify_api_key,
                dify_user_prefix,
                dify_fixed_user,
                enable_session_sync
            FROM public.ai_workflow
            ORDER BY sort_order ASC NULLS LAST, created_at DESC;
        """
        rows = db.execute(text(sql)).mappings().all()
    else:
        sql = """
            SELECT
                id,
                name,
                url,
                visible_role_groups,
                is_active,
                sort_order,
                created_at,
                dify_base_url,
                dify_api_key,
                dify_user_prefix,
                dify_fixed_user,
                enable_session_sync
            FROM public.ai_workflow
            WHERE is_active = true
              AND :role_group = ANY(visible_role_groups)
            ORDER BY sort_order ASC NULLS LAST, created_at DESC;
        """
        rows = db.execute(text(sql), {"role_group": role_group}).mappings().all()

    return [_normalize_workflow_row_for_sync(row) for row in rows]


@router.get("/ai-workflows/{workflow_id}", response_model=AIWorkflowItem)
def get_ai_workflow(
    workflow_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AIWorkflowItem:
    workflow = _fetch_workflow_by_id(db, workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow not found"
        )

    is_admin = current_user.get("role_group") == "admin"
    role_group = current_user.get("role_group", "")
    if not _is_workflow_visible(workflow, role_group, is_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden"
        )

    return workflow


@router.post("/ai-workflows", response_model=AIWorkflowItem)
def create_ai_workflow(
    payload: AIWorkflowCreateRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AIWorkflowItem:
    _ensure_admin(current_user)

    created_by = str(current_user.get("id") or current_user.get("username") or "unknown")
    row = db.execute(
        text(
            """
            INSERT INTO public.ai_workflow (
                name,
                url,
                visible_role_groups,
                is_active,
                sort_order,
                created_by,
                dify_base_url,
                dify_api_key,
                dify_user_prefix,
                dify_fixed_user,
                enable_session_sync
            )
            VALUES (
                :name,
                :url,
                :visible_role_groups,
                true,
                :sort_order,
                :created_by,
                :dify_base_url,
                :dify_api_key,
                :dify_user_prefix,
                :dify_fixed_user,
                :enable_session_sync
            )
            RETURNING
                id,
                name,
                url,
                visible_role_groups,
                is_active,
                sort_order,
                created_at,
                dify_base_url,
                dify_api_key,
                dify_user_prefix,
                enable_session_sync;
            """
        ),
        {
            "name": payload.name,
            "url": payload.url,
            "visible_role_groups": payload.visible_role_groups,
            "sort_order": payload.sort_order,
            "created_by": created_by,
            "dify_base_url": payload.dify_base_url,
            "dify_api_key": payload.dify_api_key,
            "dify_user_prefix": payload.dify_user_prefix,
            "dify_fixed_user": payload.dify_fixed_user,
            "enable_session_sync": payload.enable_session_sync,
        },
    ).mappings().first()
    db.commit()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create workflow"
        )
    return _normalize_workflow_row(row)


@router.patch("/ai-workflows/{workflow_id}", response_model=AIWorkflowItem)
def update_ai_workflow(
    workflow_id: UUID,
    payload: AIWorkflowUpdateRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AIWorkflowItem:
    _ensure_admin(current_user)
    update_data = payload.model_dump(exclude_none=True)
    if not update_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update"
        )

    allowed_fields = {
        "name",
        "url",
        "visible_role_groups",
        "is_active",
        "sort_order",
        "dify_base_url",
        "dify_api_key",
        "dify_user_prefix",
        "dify_fixed_user",
        "enable_session_sync",
    }
    set_parts = []
    params: dict[str, Any] = {"workflow_id": str(workflow_id)}
    for field, value in update_data.items():
        if field not in allowed_fields:
            continue
        set_parts.append(f"{field} = :{field}")
        params[field] = value

    if not set_parts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No valid fields to update"
        )

    sql = f"""
        UPDATE public.ai_workflow
        SET {", ".join(set_parts)}, updated_at = now()
        WHERE id = :workflow_id
        RETURNING
            id,
            name,
            url,
            visible_role_groups,
            is_active,
            sort_order,
            created_at,
            dify_base_url,
            dify_api_key,
            dify_user_prefix,
            enable_session_sync;
    """
    row = db.execute(text(sql), params).mappings().first()
    db.commit()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow not found"
        )
    return _normalize_workflow_row(row)


@router.delete("/ai-workflows/{workflow_id}")
def delete_ai_workflow(
    workflow_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    _ensure_admin(current_user)
    row = db.execute(
        text(
            """
            DELETE FROM public.ai_workflow
            WHERE id = :workflow_id
            RETURNING id;
            """
        ),
        {"workflow_id": str(workflow_id)},
    ).mappings().first()
    db.commit()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow not found"
        )
    return {"ok": True}


@router.post(
    "/ai-workflows/{workflow_id}/sessions/{session_id}/append",
    response_model=AIWorkflowSessionAppendResponse,
)
def append_ai_workflow_session_message(
    workflow_id: UUID,
    session_id: str,
    payload: AIWorkflowSessionAppendRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AIWorkflowSessionAppendResponse:
    workflow = _fetch_workflow_by_id(db, workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow not found"
        )

    is_admin = current_user.get("role_group") == "admin"
    role_group = current_user.get("role_group", "")
    if not _is_workflow_visible(workflow, role_group, is_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden"
        )

    user_identifier = str(current_user.get("id") or current_user.get("username") or "unknown")
    safe_session_id = _safe_part(session_id, "session_id")
    session_file = _build_session_file_path(workflow_id, safe_session_id, user_identifier)

    now_iso = datetime.now(timezone.utc).isoformat()
    with session_file.open("a+", encoding="utf-8") as file:
        fcntl.flock(file.fileno(), fcntl.LOCK_EX)
        try:
            file.seek(0)
            raw = file.read().strip()
            if raw:
                data = json.loads(raw)
            else:
                data = {
                    "workflow_id": str(workflow_id),
                    "workflow_name": workflow["name"],
                    "user": user_identifier,
                    "session_id": safe_session_id,
                    "created_at": now_iso,
                    "messages": [],
                }

            data.setdefault("messages", [])
            data["messages"].append(
                {
                    "role": payload.role,
                    "content": payload.content,
                    "ts": now_iso,
                }
            )

            file.seek(0)
            file.truncate()
            json.dump(data, file, ensure_ascii=False, indent=2)
            file.write("\n")
        finally:
            fcntl.flock(file.fileno(), fcntl.LOCK_UN)

    return {
        "ok": True,
        "workflow_id": workflow_id,
        "session_id": safe_session_id,
    }


@router.post(
    "/ai-workflows/{workflow_id}/sessions/{session_id}/sync-from-dify",
    response_model=AIWorkflowSyncFromDifyResponse,
)
def sync_ai_workflow_session_from_dify(
    workflow_id: UUID,
    session_id: str,
    payload: AIWorkflowSyncFromDifyRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AIWorkflowSyncFromDifyResponse:
    workflow = _fetch_workflow_by_id(db, workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow not found"
        )

    is_admin = current_user.get("role_group") == "admin"
    role_group = current_user.get("role_group", "")
    if not _is_workflow_visible(workflow, role_group, is_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden"
        )

    if not workflow.get("enable_session_sync"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session sync is disabled for this workflow"
        )

    dify_base_url = workflow.get("dify_base_url")
    dify_api_key = workflow.get("dify_api_key")
    if not dify_base_url or not dify_api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Workflow dify_base_url or dify_api_key is missing"
        )

    current_user_id = str(current_user.get("id") or current_user.get("username") or "unknown")
    safe_session_id = _safe_part(session_id, "session_id")
    dify_user = payload.user or _resolve_dify_user(workflow, current_user)

    try:
        response = requests.get(
            f"{dify_base_url.rstrip('/')}/messages",
            headers={"Authorization": f"Bearer {dify_api_key}"},
            params={
                "conversation_id": payload.conversation_id,
                "user": dify_user,
                "limit": payload.limit,
            },
            timeout=20,
        )
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to call Dify /messages"
        ) from exc

    if response.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Dify /messages failed: HTTP {response.status_code}"
        )

    try:
        result = response.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Invalid JSON from Dify /messages"
        ) from exc

    raw_items = result.get("data") or []
    if not isinstance(raw_items, list):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Invalid Dify messages payload"
        )

    session_file = _build_session_file_path(workflow_id, safe_session_id, current_user_id)
    now_iso = datetime.now(timezone.utc).isoformat()
    imported_pairs = 0
    imported_messages = 0

    with session_file.open("a+", encoding="utf-8") as file:
        fcntl.flock(file.fileno(), fcntl.LOCK_EX)
        try:
            file.seek(0)
            raw = file.read().strip()
            if raw:
                data = json.loads(raw)
            else:
                data = {
                    "workflow_id": str(workflow_id),
                    "workflow_name": workflow["name"],
                    "user": current_user_id,
                    "session_id": safe_session_id,
                    "created_at": now_iso,
                    "messages": [],
                }

            data.setdefault("messages", [])

            # Dify /messages 默认倒序返回，落盘时按时间升序写入
            for item in reversed(raw_items):
                created_at = item.get("created_at")
                ts_iso = now_iso
                if isinstance(created_at, (int, float)):
                    ts_iso = datetime.fromtimestamp(created_at, tz=timezone.utc).isoformat()
                elif isinstance(created_at, str) and created_at.strip():
                    ts_iso = created_at.strip()

                query = (item.get("query") or "").strip()
                answer = (item.get("answer") or "").strip()
                if query:
                    data["messages"].append(
                        {"role": "user", "content": query, "ts": ts_iso}
                    )
                    imported_messages += 1
                if answer:
                    data["messages"].append(
                        {"role": "assistant", "content": answer, "ts": ts_iso}
                    )
                    imported_messages += 1
                if query or answer:
                    imported_pairs += 1

            file.seek(0)
            file.truncate()
            json.dump(data, file, ensure_ascii=False, indent=2)
            file.write("\n")
        finally:
            fcntl.flock(file.fileno(), fcntl.LOCK_UN)

    db.execute(
        text(
            """
            UPDATE public.ai_workflow
            SET last_synced_at = now()
            WHERE id = :workflow_id;
            """
        ),
        {"workflow_id": str(workflow_id)},
    )
    db.commit()

    return {
        "ok": True,
        "workflow_id": workflow_id,
        "session_id": safe_session_id,
        "conversation_id": payload.conversation_id,
        "imported_pairs": imported_pairs,
        "imported_messages": imported_messages,
        "has_more": bool(result.get("has_more")),
    }


@router.get(
    "/ai-workflows/{workflow_id}/dify/conversations",
    response_model=AIDifyConversationListResponse,
)
def list_dify_conversations(
    workflow_id: UUID,
    limit: int = 20,
    last_id: str | None = None,
    sort_by: str = "-updated_at",
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AIDifyConversationListResponse:
    workflow = _fetch_workflow_by_id(db, workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow not found"
        )

    is_admin = current_user.get("role_group") == "admin"
    role_group = current_user.get("role_group", "")
    if not _is_workflow_visible(workflow, role_group, is_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden"
        )

    dify_base_url = workflow.get("dify_base_url")
    dify_api_key = workflow.get("dify_api_key")
    if not dify_base_url or not dify_api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Workflow dify_base_url or dify_api_key is missing"
        )

    if limit < 1:
        limit = 1
    if limit > 100:
        limit = 100

    allowed_sort_values = {"created_at", "-created_at", "updated_at", "-updated_at"}
    if sort_by not in allowed_sort_values:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid sort_by"
        )

    dify_user = _resolve_dify_user(workflow, current_user)

    params: dict[str, Any] = {
        "user": dify_user,
        "limit": limit,
        "sort_by": sort_by,
    }
    if last_id:
        params["last_id"] = last_id

    try:
        response = requests.get(
            f"{dify_base_url.rstrip('/')}/conversations",
            headers={"Authorization": f"Bearer {dify_api_key}"},
            params=params,
            timeout=20,
        )
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to call Dify /conversations"
        ) from exc

    if response.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Dify /conversations failed: HTTP {response.status_code}"
        )

    try:
        result = response.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Invalid JSON from Dify /conversations"
        ) from exc

    rows = result.get("data") or []
    if not isinstance(rows, list):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Invalid Dify conversations payload"
        )

    items = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        items.append(
            {
                "id": str(row.get("id") or ""),
                "name": row.get("name"),
                "status": row.get("status"),
                "created_at": row.get("created_at"),
                "updated_at": row.get("updated_at"),
            }
        )

    return {
        "data": [item for item in items if item["id"]],
        "has_more": bool(result.get("has_more")),
        "limit": int(result.get("limit") or limit),
        "dify_user": dify_user,
    }


@router.get(
    "/ai-workflows/{workflow_id}/dify/messages",
    response_model=AIDifyMessageListResponse,
)
def list_dify_messages(
    workflow_id: UUID,
    conversation_id: str,
    limit: int = 20,
    first_id: str | None = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AIDifyMessageListResponse:
    workflow = _fetch_workflow_by_id(db, workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow not found"
        )

    is_admin = current_user.get("role_group") == "admin"
    role_group = current_user.get("role_group", "")
    if not _is_workflow_visible(workflow, role_group, is_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden"
        )

    dify_base_url = workflow.get("dify_base_url")
    dify_api_key = workflow.get("dify_api_key")
    if not dify_base_url or not dify_api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Workflow dify_base_url or dify_api_key is missing"
        )

    normalized_conversation_id = conversation_id.strip()
    if not normalized_conversation_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="conversation_id is required"
        )

    if limit < 1:
        limit = 1
    if limit > 100:
        limit = 100

    dify_user = _resolve_dify_user(workflow, current_user)
    params: dict[str, Any] = {
        "conversation_id": normalized_conversation_id,
        "user": dify_user,
        "limit": limit,
    }
    if first_id:
        params["first_id"] = first_id

    try:
        response = requests.get(
            f"{dify_base_url.rstrip('/')}/messages",
            headers={"Authorization": f"Bearer {dify_api_key}"},
            params=params,
            timeout=20,
        )
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to call Dify /messages"
        ) from exc

    if response.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Dify /messages failed: HTTP {response.status_code}"
        )

    try:
        result = response.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Invalid JSON from Dify /messages"
        ) from exc

    rows = result.get("data") or []
    if not isinstance(rows, list):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Invalid Dify messages payload"
        )

    items = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        items.append(
            {
                "id": str(row.get("id") or ""),
                "conversation_id": row.get("conversation_id"),
                "query": row.get("query"),
                "answer": row.get("answer"),
                "created_at": row.get("created_at"),
            }
        )

    return {
        "data": [item for item in items if item["id"]],
        "has_more": bool(result.get("has_more")),
        "limit": int(result.get("limit") or limit),
        "dify_user": dify_user,
        "conversation_id": normalized_conversation_id,
    }
