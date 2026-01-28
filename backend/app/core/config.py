import os

from dotenv import load_dotenv

# 启动时加载本地 .env，便于开发环境配置。
load_dotenv()


def get_env(name: str, default: str = "") -> str:
    return os.getenv(name, default)


# Supabase 相关配置。
SUPABASE_URL = get_env("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = get_env("SUPABASE_SERVICE_ROLE_KEY")
SUPABASE_JWT_PUBLIC_KEY = get_env("SUPABASE_JWT_PUBLIC_KEY")

# PostgreSQL 连接地址。
DATABASE_URL = get_env("DATABASE_URL")

# JWT 配置（用于后端自签发）。
JWT_SECRET = get_env("JWT_SECRET", "dev-secret-change-me")
JWT_ALGORITHM = get_env("JWT_ALGORITHM", "HS256")
JWT_EXPIRES_MINUTES = int(get_env("JWT_EXPIRES_MINUTES", "60"))
