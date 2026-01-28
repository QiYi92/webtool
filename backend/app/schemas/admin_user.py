from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr


class AdminUser(BaseModel):
    id: UUID
    username: str
    email: EmailStr
    role_group: str
    created_at: datetime
    updated_at: datetime


class CreateUserRequest(BaseModel):
    username: str
    email: EmailStr
    password: str
    role_group: str


class UpdateUserRequest(BaseModel):
    username: str
    email: EmailStr
    role_group: str
    password: str | None = None
