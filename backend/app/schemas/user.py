from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    identifier: str
    password: str


class UserPublic(BaseModel):
    id: str
    username: str
    email: EmailStr
    role_group: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    user: UserPublic


class UpdateAccountRequest(BaseModel):
    username: str
    email: EmailStr


class UpdatePasswordRequest(BaseModel):
    old_password: str
    new_password: str
    new_password_confirm: str


class OkResponse(BaseModel):
    ok: bool
