from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str


class ToolItem(BaseModel):
    id: str
    name: str
    status: str
