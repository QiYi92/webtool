from fastapi import APIRouter, Depends

from app.core.security import get_current_user

router = APIRouter()


@router.get("/")
def list_tools(current_user: dict = Depends(get_current_user)) -> dict:
    # 示例接口：返回静态数据并带上用户标识。
    return {
        "user_id": current_user["id"],
        "tools": [
            {"id": "example", "name": "Example Tool", "status": "placeholder"}
        ]
    }
