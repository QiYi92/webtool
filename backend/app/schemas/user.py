from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    identifier: str
    password: str
    captcha_id: str
    captcha_answer: str


class CaptchaResponse(BaseModel):
    captcha_id: str
    image_data: str
    expires_in_seconds: int


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
