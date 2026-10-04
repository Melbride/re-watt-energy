from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from ..enums import VerificationStatus

__all__ = [
    "RegisterIn",
    "RegisterOut",
    "LoginIn",
    "LoginOut",
    "RefreshTokenIn",
    "SendCodeIn",
    "VerifyCodeIn",
    "VerifyEmailIn",
    "UserProfileOut",
    "RoleOption",
    "SupplierOnboardingIn",
    "BuyerOnboardingIn",
]


class RoleOption(BaseModel):
    value: str
    label: str
    description: str


class RegisterIn(BaseModel):
    model_config = ConfigDict(str_trim_ws=True)

    email: EmailStr
    password: str = Field(min_length=8)
    full_name: str = Field(min_length=2, max_length=255)
    role: Literal["supplier", "buyer"]
    phone: str | None = Field(default=None, max_length=32)

    # supplier onboarding (optional at registration)
    supplier_type: str | None = None
    business_name: str | None = None
    county: str | None = None
    city: str | None = None

    # buyer onboarding (optional at registration)
    business_name_buy: str | None = None
    business_type: str | None = None

    @model_validator(mode="after")
    def _check(self):  # noqa: D401
        if self.role == "supplier" and not self.supplier_type:
            raise ValueError("supplier_type is required for suppliers")
        if self.role == "buyer" and not self.business_name_buy:
            raise ValueError("business_name is required for buyers")
        return self


class RegisterOut(BaseModel):
    ok: bool = True
    message: str = "Account created. Complete onboarding and verification to start transacting."
    user_id: int
    role: str
    status: str = VerificationStatus.PENDING


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class LoginOut(BaseModel):
    access_token: str
    refresh_token: str | None = None
    token_type: str = "bearer"
    user: "UserProfileOut"


class RefreshTokenIn(BaseModel):
    refresh_token: str


class SendCodeIn(BaseModel):
    email: EmailStr | None = None
    phone: str | None = None
    purpose: Literal["email_verification", "phone_verification", "login"] = "email_verification"


class VerifyCodeIn(BaseModel):
    email: EmailStr | None = None
    phone: str | None = None
    code: str
    purpose: Literal["email_verification", "phone_verification", "login"] = "email_verification"


class VerifyEmailIn(BaseModel):
    token: str


class SupplierOnboardingIn(BaseModel):
    full_name: str | None = None
    phone: str | None = None
    supplier_type: str
    business_name: str | None = None
    id_number: str | None = None
    county: str | None = None
    city: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    description: str | None = None


class BuyerOnboardingIn(BaseModel):
    full_name: str | None = None
    phone: str | None = None
    business_name: str
    business_type: str | None = None
    registration_number: str | None = None
    county: str | None = None
    city: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    intended_use_note: str | None = None
