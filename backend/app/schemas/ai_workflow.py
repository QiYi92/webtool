from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, field_validator


class AIWorkflowItem(BaseModel):
    id: UUID
    name: str
    url: str
    visible_role_groups: list[str]
    is_active: bool
    sort_order: int
    created_at: datetime
    dify_base_url: str | None = None
    dify_user_prefix: str | None = None
    dify_fixed_user: str | None = None
    enable_session_sync: bool | None = None


class AIWorkflowCreateRequest(BaseModel):
    name: str
    url: str
    visible_role_groups: list[str]
    sort_order: int = 0
    dify_base_url: str | None = None
    dify_api_key: str | None = None
    dify_user_prefix: str = "gcw"
    dify_fixed_user: str | None = None
    enable_session_sync: bool = False

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("name is required")
        return normalized

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized or not normalized.lower().startswith(("http://", "https://")):
            raise ValueError("url must start with http:// or https://")
        return normalized

    @field_validator("visible_role_groups")
    @classmethod
    def validate_visible_role_groups(cls, value: list[str]) -> list[str]:
        groups = [item.strip() for item in value if item and item.strip()]
        if not groups:
            raise ValueError("visible_role_groups must have at least one role")
        return list(dict.fromkeys(groups))

    @field_validator("dify_base_url")
    @classmethod
    def validate_dify_base_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            return None
        if not normalized.lower().startswith(("http://", "https://")):
            raise ValueError("dify_base_url must start with http:// or https://")
        return normalized.rstrip("/")

    @field_validator("dify_api_key")
    @classmethod
    def validate_dify_api_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("dify_user_prefix")
    @classmethod
    def validate_dify_user_prefix(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("dify_user_prefix is required")
        return normalized

    @field_validator("dify_fixed_user")
    @classmethod
    def validate_dify_fixed_user(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class AIWorkflowUpdateRequest(BaseModel):
    name: str | None = None
    url: str | None = None
    visible_role_groups: list[str] | None = None
    is_active: bool | None = None
    sort_order: int | None = None
    dify_base_url: str | None = None
    dify_api_key: str | None = None
    dify_user_prefix: str | None = None
    dify_fixed_user: str | None = None
    enable_session_sync: bool | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("name cannot be empty")
        return normalized

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized or not normalized.lower().startswith(("http://", "https://")):
            raise ValueError("url must start with http:// or https://")
        return normalized

    @field_validator("visible_role_groups")
    @classmethod
    def validate_visible_role_groups(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        groups = [item.strip() for item in value if item and item.strip()]
        if not groups:
            raise ValueError("visible_role_groups must have at least one role")
        return list(dict.fromkeys(groups))

    @field_validator("dify_base_url")
    @classmethod
    def validate_dify_base_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            return None
        if not normalized.lower().startswith(("http://", "https://")):
            raise ValueError("dify_base_url must start with http:// or https://")
        return normalized.rstrip("/")

    @field_validator("dify_api_key")
    @classmethod
    def validate_dify_api_key(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("dify_user_prefix")
    @classmethod
    def validate_dify_user_prefix(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("dify_user_prefix cannot be empty")
        return normalized

    @field_validator("dify_fixed_user")
    @classmethod
    def validate_dify_fixed_user(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class AIWorkflowSessionAppendRequest(BaseModel):
    role: Literal["user", "assistant"]
    content: str

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("content is required")
        return normalized


class AIWorkflowSessionAppendResponse(BaseModel):
    ok: bool
    workflow_id: UUID
    session_id: str


class AIWorkflowSyncFromDifyRequest(BaseModel):
    conversation_id: str
    limit: int = 100
    user: str | None = None

    @field_validator("conversation_id")
    @classmethod
    def validate_conversation_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("conversation_id is required")
        return normalized

    @field_validator("limit")
    @classmethod
    def validate_limit(cls, value: int) -> int:
        if value < 1:
            return 1
        if value > 100:
            return 100
        return value

    @field_validator("user")
    @classmethod
    def validate_user(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class AIWorkflowSyncFromDifyResponse(BaseModel):
    ok: bool
    workflow_id: UUID
    session_id: str
    conversation_id: str
    imported_pairs: int
    imported_messages: int
    has_more: bool


class AIDifyConversationItem(BaseModel):
    id: str
    name: str | None = None
    status: str | None = None
    created_at: int | None = None
    updated_at: int | None = None


class AIDifyConversationListResponse(BaseModel):
    data: list[AIDifyConversationItem]
    has_more: bool
    limit: int
    dify_user: str


class AIDifyMessageItem(BaseModel):
    id: str
    conversation_id: str | None = None
    query: str | None = None
    answer: str | None = None
    created_at: int | None = None


class AIDifyMessageListResponse(BaseModel):
    data: list[AIDifyMessageItem]
    has_more: bool
    limit: int
    dify_user: str
    conversation_id: str
