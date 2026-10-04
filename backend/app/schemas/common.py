from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Generic, TypeVar

from pydantic import BaseModel, field_validator

T = TypeVar("T")


class PaginatedMeta(BaseModel):
    page: int
    size: int
    total: int
    pages: int


class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    meta: PaginatedMeta


class ErrorResponse(BaseModel):
    ok: bool = False
    error: str
    details: list[str] = []


class SuccessResponse(BaseModel):
    ok: bool = True
    message: str | None = None


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenPayload(BaseModel):
    sub: int | None = None
    role: str | None = None
    exp: int | None = None


class CoordinatesIn(BaseModel):
    latitude: Decimal | None = None
    longitude: Decimal | None = None


class MoneyIn(BaseModel):
    amount: Decimal
    currency: str

    @field_validator("currency")
    @classmethod
    def _upper(cls, v: str) -> str:
        return (v or "KES").strip().upper()


class QuantityIn(BaseModel):
    quantity: Decimal
    unit: str

    @field_validator("unit")
    @classmethod
    def _normalise(cls, v: str) -> str:
        from ..services.units import normalise_unit

        return normalise_unit(v)


class QuantityOut(BaseModel):
    declared: Decimal
    unit: str
    base: Decimal
    base_unit: str
    label: str


class FileRef(BaseModel):
    url: str
    filename: str
    size: int | None = None


class EnumItem(BaseModel):
    value: str
    label: str
    description: str | None = None
