from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    DateTime,
    Decimal as SqlDecimal,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..database import Base
from .base import TimestampMixin


class User(Base, TimestampMixin):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32), unique=True, index=True, nullable=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    phone_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    onboarding_completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    supplier_profile: Mapped["SupplierProfile | None"] = relationship(
        "SupplierProfile", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    buyer_profile: Mapped["BuyerProfile | None"] = relationship(
        "BuyerProfile", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    verifications: Mapped[list["VerificationRecord"]] = relationship(
        "VerificationRecord", back_populates="user", cascade="all, delete-orphan"
    )
    listings: Mapped[list["Listing"]] = relationship(
        "Listing", back_populates="supplier", cascade="all, delete-orphan"
    )
    requirements: Mapped[list["BuyerRequirement"]] = relationship(
        "BuyerRequirement", back_populates="buyer", cascade="all, delete-orphan"
    )
    received_matches: Mapped[list["Match"]] = relationship(
        "Match", back_populates="buyer", cascade="all, delete-orphan"
    )
    match_items: Mapped[list["MatchItem"]] = relationship(
        "MatchItem", back_populates="supplier_user", cascade="all, delete-orphan"
    )
    notifications: Mapped[list["Notification"]] = relationship(
        "Notification", back_populates="user", cascade="all, delete-orphan"
    )
    feedback_given: Mapped[list["Feedback"]] = relationship(
        "Feedback",
        foreign_keys="Feedback.author_id",
        back_populates="author",
        cascade="all, delete-orphan",
    )
    feedback_received: Mapped[list["Feedback"]] = relationship(
        "Feedback",
        foreign_keys="Feedback.subject_id",
        back_populates="subject",
        cascade="all, delete-orphan",
    )
    payments_made: Mapped[list["Payment"]] = relationship(
        "Payment", foreign_keys="Payment.payer_id", back_populates="payer",
    )
    payments_received: Mapped[list["Payment"]] = relationship(
        "Payment", foreign_keys="Payment.payee_id", back_populates="payee",
    )
    __table_args__ = (Index("ix_users_role_status", "role", "status"),)


class SupplierProfile(Base, TimestampMixin):
    __tablename__ = "supplier_profiles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    supplier_type: Mapped[str] = mapped_column(String(64), nullable=False)
    business_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    county: Mapped[str | None] = mapped_column(String(128), nullable=True)
    city: Mapped[str | None] = mapped_column(String(128), nullable=True)
    latitude: Mapped[Decimal | None] = mapped_column(SqlDecimal(9, 6), nullable=True)
    longitude: Mapped[Decimal | None] = mapped_column(SqlDecimal(9, 6), nullable=True)
    id_number: Mapped[str | None] = mapped_column(String(128), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    verification_status: Mapped[str] = mapped_column(
        String(32), default="pending", nullable=False
    )
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    verified_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="supplier_profile")


class BuyerProfile(Base, TimestampMixin):
    __tablename__ = "buyer_profiles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    business_name: Mapped[str] = mapped_column(String(255), nullable=False)
    business_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    county: Mapped[str | None] = mapped_column(String(128), nullable=True)
    city: Mapped[str | None] = mapped_column(String(128), nullable=True)
    latitude: Mapped[Decimal | None] = mapped_column(SqlDecimal(9, 6), nullable=True)
    longitude: Mapped[Decimal | None] = mapped_column(SqlDecimal(9, 6), nullable=True)
    registration_number: Mapped[str | None] = mapped_column(String(128), nullable=True)
    verification_status: Mapped[str] = mapped_column(
        String(32), default="pending", nullable=False
    )
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    verified_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    intended_use_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="buyer_profile")


class VerificationRecord(Base, TimestampMixin):
    __tablename__ = "verification_records"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    document_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    code_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    code_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_url: Mapped[str | None] = mapped_column(String(512), nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="verifications")

    __table_args__ = (Index("ix_verifications_user_type", "user_id", "type"),)
