"""All ORM models. Importing this package registers every mapper with the Base."""

from __future__ import annotations

from .base import TimestampMixin, utcnow
from .marketplace import (
    BuyerRequirement,
    Category,
    Dispute,
    DisputeMessage,
    Feedback,
    Listing,
    ListingEvidence,
    Match,
    MatchItem,
    Material,
    Notification,
    Payment,
    Transaction,
)
from .user import (
    BuyerProfile,
    SupplierProfile,
    User,
    VerificationRecord,
)

__all__ = [
    "Base",
    "TimestampMixin",
    "utcnow",
    "User",
    "SupplierProfile",
    "BuyerProfile",
    "VerificationRecord",
    "Category",
    "Material",
    "Listing",
    "ListingEvidence",
    "BuyerRequirement",
    "Match",
    "MatchItem",
    "Transaction",
    "Payment",
    "Dispute",
    "DisputeMessage",
    "Feedback",
    "Notification",
]

# Re-export Base for convenience (database.py also holds it)
from ..database import Base  # noqa: E402, F401

__all__.append("Base")
