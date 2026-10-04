from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from .common import EnumItem  # noqa: F401


class VerificationRecordOut(BaseModel):
    id: int
    type: str
    status: str
    document_reference: str | None = None
    notes: str | None = None
    evidence_url: str | None = None
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None
    reviewed_notes: str | None = None
    code_expires_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class SupplierProfileOut(BaseModel):
    id: int
    supplier_type: str
    business_name: str | None = None
    county: str | None = None
    city: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    id_number: str | None = None
    description: str | None = None
    verification_status: str
    verified_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class BuyerProfileOut(BaseModel):
    id: int
    business_name: str
    business_type: str | None = None
    county: str | None = None
    city: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    registration_number: str | None = None
    verification_status: str
    verified_at: datetime | None = None
    intended_use_note: str | None = None

    model_config = ConfigDict(from_attributes=True)


class ReputationOut(BaseModel):
    rating: Decimal
    rating_count: int
    completed_transactions: int
    supplier: bool
    buyer: bool
    verified: bool
    first_transaction_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class UserProfileOut(BaseModel):
    id: int
    email: str
    phone: str | None = None
    full_name: str
    role: str
    status: str
    is_active: bool
    email_verified: bool
    phone_verified: bool
    onboarding_completed: bool
    is_verified_business: bool
    created_at: datetime
    last_login_at: datetime | None = None
    reputation: ReputationOut | None = None
    verifications: list[VerificationRecordOut] = []
    supplier_profile: SupplierProfileOut | None = None
    buyer_profile: BuyerProfileOut | None = None


class UpdateProfileIn(BaseModel):
    full_name: str | None = None
    phone: str | None = None
    avatar_url: str | None = None
    supplier_type: str | None = None
    business_name: str | None = None
    id_number: str | None = None
    supplier_county: str | None = None
    supplier_city: str | None = None
    supplier_latitude: float | None = None
    supplier_longitude: float | None = None
    description: str | None = None
    buyer_business_name: str | None = None
    buyer_business_type: str | None = None
    buyer_county: str | None = None
    buyer_city: str | None = None
    buyer_latitude: float | None = None
    buyer_longitude: float | None = None
    registration_number: str | None = None
    intended_use_note: str | None = None


class DocumentReferenceOut(BaseModel):
    id: int
    kind: str
    url: str
    caption: str | None = None
    uploaded_by: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
