"""Domain enumerations shared by models, schemas and services."""

from __future__ import annotations

from enum import Enum


class StrEnum(str, Enum):
    """String enum that serialises to its value in JSON and DB."""

    def __str__(self) -> str:  # pragma: no cover - convenience only
        return str(self.value)


class UserRole(StrEnum):
    SUPPLIER = "supplier"
    BUYER = "buyer"
    ADMIN = "admin"


class VerificationStatus(StrEnum):
    PENDING = "pending"
    VERIFIED = "verified"
    REJECTED = "rejected"


class VerificationType(StrEnum):
    PHONE = "phone"
    EMAIL = "email"
    IDENTITY = "identity"
    BUSINESS = "business"
    ADDRESS = "address"


class MaterialCondition(StrEnum):
    DRY = "dry"
    WET = "wet"
    MIXED = "mixed"
    CONTAMINATED = "contaminated"
    PROCESSED = "processed"
    UNSORTED = "unsorted"
    UNKNOWN = "unknown"


class ListingStatus(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    PARTIALLY_ALLOCATED = "partially_allocated"
    FULLY_ALLOCATED = "fully_allocated"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class RequirementStatus(StrEnum):
    OPEN = "open"
    MATCH_REQUESTED = "match_requested"
    CONFIRMED = "confirmed"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class MatchStatus(StrEnum):
    PROPOSED = "proposed"
    REQUESTED = "requested"
    PARTIALLY_ACCEPTED = "partially_accepted"
    CONFIRMED = "confirmed"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    DECLINED = "declined"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class MatchItemStatus(StrEnum):
    INVITED = "invited"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    WITHDRAWN = "withdrawn"
    FULFILLED = "fulfilled"


class TransactionStatus(StrEnum):
    PENDING_HANDOVER = "pending_handover"
    IN_TRANSIT = "in_transit"
    DELIVERED = "delivered"
    QUANTITY_CONFIRMED = "quantity_confirmed"
    PAYMENT_PENDING = "payment_pending"
    PAID = "paid"
    COMPLETED = "completed"
    DISPUTED = "disputed"
    CANCELLED = "cancelled"


class PaymentStatus(StrEnum):
    PENDING = "pending"
    HELD = "held"
    RELEASED = "released"
    REFUNDED = "refunded"
    FAILED = "failed"


class PaymentMethod(StrEnum):
    MOBILE_MONEY = "mobile_money"
    BANK_TRANSFER = "bank_transfer"
    CASH = "cash"
    OTHER = "other"


class DisputeStatus(StrEnum):
    OPEN = "open"
    AWAITING_INFO = "awaiting_info"
    UNDER_REVIEW = "under_review"
    RESOLVED = "resolved"
    CLOSED = "closed"


class DisputeResolution(StrEnum):
    NONE = "none"
    FULL_BUYER = "full_buyer"
    FULL_SUPPLIER = "full_supplier"
    SPLIT = "split"
    WITHDRAWN = "withdrawn"


class NotificationType(StrEnum):
    VERIFICATION = "verification"
    LISTING = "listing"
    MATCH_INVITE = "match_invite"
    MATCH_ACCEPTED = "match_accepted"
    MATCH_DECLINED = "match_declined"
    MATCH_CONFIRMED = "match_confirmed"
    TRANSACTION = "transaction"
    PAYMENT = "payment"
    DISPUTE = "dispute"
    SYSTEM = "system"


class MatchSource(StrEnum):
    BUYER_SEARCH = "buyer_search"
    SUPPLIER_DISCOVERY = "supplier_discovery"
    ADMIN = "admin"


class FeedbackRole(StrEnum):
    BUYER = "buyer"
    SUPPLIER = "supplier"
