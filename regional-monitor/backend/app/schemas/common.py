"""공통 스키마."""
from typing import Literal
from pydantic import BaseModel

VerdictType = Literal[
    "OK",
    "PHONE_MISMATCH",
    "DONG_MISMATCH",
    "NAME_MISMATCH",
    "REGION_MISMATCH",
    "DEAD",
    "PENDING",
    "CHECKING",
]


class MessageResponse(BaseModel):
    message: str
