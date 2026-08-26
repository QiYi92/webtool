from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.config import DSA_SSO_SECRET, DSA_SSO_TTL_SECONDS, JWT_ALGORITHM
from app.core.security import get_current_user


router = APIRouter(prefix="/tools/dsa", tags=["dsa"])


@router.post("/session")
def create_dsa_session(current_user: dict = Depends(get_current_user)) -> dict[str, str]:
    """Create a short-lived bootstrap ticket for the embedded DSA service."""
    if len(DSA_SSO_SECRET) < 32:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="DSA 单点登录密钥尚未安全配置",
        )

    expires_at = datetime.now(timezone.utc) + timedelta(seconds=DSA_SSO_TTL_SECONDS)
    ticket = jwt.encode(
        {
            "sub": str(current_user["id"]),
            "role": str(current_user.get("role_group") or "user"),
            "aud": "dsa",
            "iss": "galileocat-webtool",
            "exp": expires_at,
        },
        DSA_SSO_SECRET,
        algorithm=JWT_ALGORITHM,
    )
    return {"launch_url": f"/dsa/sso/launch?ticket={ticket}"}
