from passlib.context import CryptContext

# 统一密码哈希/校验策略，便于后续替换算法。
_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, password_hash: str) -> bool:
    return _pwd_context.verify(plain_password, password_hash)


def get_password_hash(plain_password: str) -> str:
    return _pwd_context.hash(plain_password)
