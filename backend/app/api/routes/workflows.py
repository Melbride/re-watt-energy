from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ...database import get_db
from ...enums import DisputeResolution, DisputeStatus, NotificationType, TransactionStatus
from ...models import Dispute, DisputeMessage, Notification, Transaction, User
from ...security import get_current_user, require_roles
from ...services.notifications import create_notification, notify_admins
from ...services.units import from_base, to_base
from .marketplace import _transaction_out

router = APIRouter(tags=["Marketplace workflows"])


class HandoverIn(BaseModel):
    notes: str | None = Field(default=None, max_length=2000)
    evidence: dict | None = None


class DisputeIn(BaseModel):
    reason: str = Field(min_length=5, max_length=512)
    message: str | None = Field(default=None, min_length=1, max_length=4000)
    claim_quantity: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=4)

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 5:
            raise ValueError("Reason must contain at least 5 non-whitespace characters.")
        return value

    @field_validator("message")
    @classmethod
    def normalize_message(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("Message cannot be empty.")
        return value.strip() if value is not None else None


class DisputeMessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)

    @field_validator("body")
    @classmethod
    def normalize_body(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Message cannot be empty.")
        return value


class DisputeResolutionIn(BaseModel):
    resolution: Literal["full_buyer", "full_supplier", "split", "withdrawn"]
    notes: str = Field(min_length=1, max_length=4000)

    @field_validator("notes")
    @classmethod
    def normalize_notes(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Resolution notes cannot be empty.")
        return value


def _notification_out(notification: Notification) -> dict:
    return {
        "id": notification.id,
        "type": notification.type,
        "title": notification.title,
        "body": notification.body,
        "link": notification.link,
        "meta": notification.meta,
        "read_at": notification.read_at.isoformat() if notification.read_at else None,
        "created_at": notification.created_at.isoformat(),
    }


def _dispute_out(dispute: Dispute, transaction: Transaction) -> dict:
    return {
        "id": dispute.id,
        "transaction_id": dispute.transaction_id,
        "status": dispute.status,
        "resolution": dispute.resolution,
        "reason": dispute.reason,
        "supplier_claim_quantity": (
            float(from_base(dispute.supplier_claim_qty_base, transaction.unit))
            if dispute.supplier_claim_qty_base is not None
            else None
        ),
        "buyer_claim_quantity": (
            float(from_base(dispute.buyer_claim_qty_base, transaction.unit))
            if dispute.buyer_claim_qty_base is not None
            else None
        ),
        "resolution_notes": dispute.resolution_notes,
        "opened_by_id": dispute.opened_by_id,
        "resolved_by_id": dispute.resolved_by_id,
        "resolved_at": dispute.resolved_at.isoformat() if dispute.resolved_at else None,
        "created_at": dispute.created_at.isoformat(),
        "transaction_status": transaction.status,
        "material": transaction.material.name,
        "supplier_id": transaction.supplier_id,
        "supplier_name": transaction.supplier.full_name,
        "buyer_id": transaction.buyer_id,
        "buyer_name": transaction.buyer.full_name,
        "messages": [
            {
                "id": message.id,
                "author_id": message.author_id,
                "author_name": message.author.full_name if message.author else "Marketplace admin",
                "body": message.body,
                "created_at": message.created_at.isoformat(),
            }
            for message in sorted(
                dispute.messages, key=lambda item: (item.created_at, item.id)
            )
        ],
    }


def _load_dispute(db: Session, dispute_id: int) -> Dispute | None:
    return db.scalars(
        select(Dispute)
        .where(Dispute.id == dispute_id)
        .options(
            joinedload(Dispute.transaction).joinedload(Transaction.material),
            joinedload(Dispute.transaction).joinedload(Transaction.supplier),
            joinedload(Dispute.transaction).joinedload(Transaction.buyer),
            joinedload(Dispute.transaction).joinedload(Transaction.payments),
            joinedload(Dispute.messages).joinedload(DisputeMessage.author),
        )
    ).unique().one_or_none()


def _require_participant(dispute: Dispute, user: User) -> None:
    if user.role != "admin" and user.id not in {
        dispute.transaction.buyer_id,
        dispute.transaction.supplier_id,
    }:
        raise HTTPException(status_code=404, detail="Dispute not found.")


@router.get("/notifications")
def get_notifications(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    notifications = db.scalars(
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
    ).all()
    return [_notification_out(notification) for notification in notifications]


@router.post("/notifications/{notification_id}/read")
@router.patch("/notifications/{notification_id}/read", include_in_schema=False)
def mark_notification_read(
    notification_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    notification = db.scalar(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == user.id,
        )
    )
    if notification is None:
        raise HTTPException(status_code=404, detail="Notification not found.")
    if notification.read_at is None:
        notification.read_at = datetime.now(timezone.utc)
        db.commit()
    return _notification_out(notification)


@router.post("/notifications/read-all")
def mark_all_notifications_read(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    notifications = db.scalars(
        select(Notification).where(
            Notification.user_id == user.id,
            Notification.read_at.is_(None),
        )
    ).all()
    now = datetime.now(timezone.utc)
    for notification in notifications:
        notification.read_at = now
    if notifications:
        db.commit()
    return {"updated_count": len(notifications)}


@router.post("/transactions/{transaction_id}/handover")
def record_handover(
    transaction_id: int,
    payload: HandoverIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("supplier")),
):
    transaction = db.scalar(
        select(Transaction).where(
            Transaction.id == transaction_id,
            Transaction.supplier_id == user.id,
        )
    )
    if transaction is None:
        raise HTTPException(status_code=404, detail="Transaction not found.")
    if transaction.status != TransactionStatus.PENDING_HANDOVER.value:
        raise HTTPException(status_code=409, detail="Handover cannot be recorded in the current transaction state.")
    transaction.status = TransactionStatus.IN_TRANSIT.value
    transaction.handover_at = datetime.now(timezone.utc)
    if payload.notes is not None:
        transaction.notes = payload.notes
    if payload.evidence is not None:
        transaction.evidence = payload.evidence
    create_notification(
        db,
        user_id=transaction.buyer_id,
        notification_type=NotificationType.TRANSACTION.value,
        title="Supplier handed over your material",
        body=f"{user.full_name} recorded the handover for transaction {transaction.id}.",
        link=f"/transactions/{transaction.id}",
        meta={"transaction_id": transaction.id, "status": transaction.status},
    )
    db.commit()
    return {
        **_transaction_out(transaction),
        "transaction_id": transaction.id,
        "handover_at": transaction.handover_at.isoformat(),
        "notes": transaction.notes,
        "evidence": transaction.evidence,
    }


@router.post("/transactions/{transaction_id}/disputes", status_code=status.HTTP_201_CREATED)
def open_dispute(
    transaction_id: int,
    payload: DisputeIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("buyer", "supplier")),
):
    transaction = db.scalar(
        select(Transaction).where(
            Transaction.id == transaction_id,
            (
                Transaction.buyer_id == user.id
                if user.role == "buyer"
                else Transaction.supplier_id == user.id
            ),
        )
    )
    if transaction is None:
        raise HTTPException(status_code=404, detail="Transaction not found.")
    if transaction.status in {TransactionStatus.DISPUTED.value, TransactionStatus.CANCELLED.value}:
        raise HTTPException(status_code=409, detail="A dispute cannot be opened in the current transaction state.")
    if transaction.dispute is not None:
        raise HTTPException(status_code=409, detail="A dispute has already been opened for this transaction.")

    claim_base = None
    if payload.claim_quantity is not None:
        try:
            claim_base = to_base(payload.claim_quantity, transaction.unit)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if claim_base > transaction.quantity_declared_base:
            raise HTTPException(status_code=422, detail="Claim quantity cannot exceed the transaction quantity.")

    dispute = Dispute(
        transaction_id=transaction.id,
        opened_by_id=user.id,
        reason=payload.reason.strip(),
        supplier_claim_qty_base=claim_base if user.role == "supplier" else None,
        buyer_claim_qty_base=claim_base if user.role == "buyer" else None,
        status=DisputeStatus.OPEN.value,
    )
    transaction.status = TransactionStatus.DISPUTED.value
    db.add(dispute)
    db.flush()
    if payload.message:
        db.add(DisputeMessage(dispute_id=dispute.id, author_id=user.id, body=payload.message.strip()))

    other_party_id = (
        transaction.supplier_id if user.id == transaction.buyer_id else transaction.buyer_id
    )
    create_notification(
        db,
        user_id=other_party_id,
        notification_type=NotificationType.DISPUTE.value,
        title="A transaction dispute was opened",
        body=f"{user.full_name} opened a dispute for transaction {transaction.id}.",
        link=f"/disputes/{dispute.id}",
        meta={"dispute_id": dispute.id, "transaction_id": transaction.id},
    )
    notify_admins(
        db,
        notification_type=NotificationType.DISPUTE.value,
        title="A marketplace dispute needs review",
        body=f"A dispute was opened for transaction {transaction.id}.",
        link=f"/admin/disputes/{dispute.id}",
        meta={"dispute_id": dispute.id, "transaction_id": transaction.id},
    )
    db.commit()
    dispute = _load_dispute(db, dispute.id)
    return _dispute_out(dispute, dispute.transaction)


@router.get("/disputes")
def get_disputes(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = select(Dispute).options(
        joinedload(Dispute.transaction).joinedload(Transaction.material),
        joinedload(Dispute.transaction).joinedload(Transaction.supplier),
        joinedload(Dispute.transaction).joinedload(Transaction.buyer),
        joinedload(Dispute.transaction).joinedload(Transaction.payments),
        joinedload(Dispute.messages).joinedload(DisputeMessage.author),
    )
    if user.role != "admin":
        query = query.join(Transaction).where(
            (Transaction.buyer_id == user.id) | (Transaction.supplier_id == user.id)
        )
    disputes = db.scalars(query.order_by(Dispute.created_at.desc())).unique().all()
    return [_dispute_out(dispute, dispute.transaction) for dispute in disputes]


@router.get("/disputes/{dispute_id}")
def get_dispute(
    dispute_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    dispute = _load_dispute(db, dispute_id)
    if dispute is None:
        raise HTTPException(status_code=404, detail="Dispute not found.")
    _require_participant(dispute, user)
    return _dispute_out(dispute, dispute.transaction)


@router.post("/disputes/{dispute_id}/messages", status_code=status.HTTP_201_CREATED)
def add_dispute_message(
    dispute_id: int,
    payload: DisputeMessageIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    dispute = _load_dispute(db, dispute_id)
    if dispute is None:
        raise HTTPException(status_code=404, detail="Dispute not found.")
    _require_participant(dispute, user)
    if dispute.status in {DisputeStatus.RESOLVED.value, DisputeStatus.CLOSED.value}:
        raise HTTPException(status_code=409, detail="Messages cannot be added to a resolved dispute.")
    message = DisputeMessage(
        dispute_id=dispute.id,
        author_id=user.id,
        body=payload.body,
    )
    db.add(message)
    if user.role == "admin":
        dispute.latest_admin_id = user.id
        recipients = [dispute.transaction.buyer_id, dispute.transaction.supplier_id]
    else:
        other_party_id = (
            dispute.transaction.supplier_id
            if user.id == dispute.transaction.buyer_id
            else dispute.transaction.buyer_id
        )
        recipients = [other_party_id]
        admin_ids = db.scalars(select(User.id).where(User.role == "admin")).all()
        recipients.extend(admin_ids)
    for recipient_id in set(recipients):
        create_notification(
            db,
            user_id=recipient_id,
            notification_type=NotificationType.DISPUTE.value,
            title="New message in a transaction dispute",
            body=f"{user.full_name} added a message to dispute {dispute.id}.",
            link=f"/disputes/{dispute.id}",
            meta={"dispute_id": dispute.id, "transaction_id": dispute.transaction_id},
        )
    db.commit()
    db.refresh(message)
    return {
        "id": message.id,
        "dispute_id": message.dispute_id,
        "author_id": message.author_id,
        "author_name": user.full_name,
        "body": message.body,
        "created_at": message.created_at.isoformat(),
    }


@router.get("/admin/disputes")
def get_admin_disputes(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_roles("admin")),
):
    disputes = db.scalars(
        select(Dispute)
        .options(
            joinedload(Dispute.transaction).joinedload(Transaction.material),
            joinedload(Dispute.transaction).joinedload(Transaction.supplier),
            joinedload(Dispute.transaction).joinedload(Transaction.buyer),
            joinedload(Dispute.transaction).joinedload(Transaction.payments),
            joinedload(Dispute.messages).joinedload(DisputeMessage.author),
        )
        .order_by(Dispute.created_at.desc())
    ).unique().all()
    return [_dispute_out(dispute, dispute.transaction) for dispute in disputes]


@router.patch("/disputes/{dispute_id}/resolve")
@router.post("/admin/disputes/{dispute_id}/resolve", include_in_schema=False)
def resolve_dispute(
    dispute_id: int,
    payload: DisputeResolutionIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_roles("admin")),
):
    dispute = _load_dispute(db, dispute_id)
    if dispute is None:
        raise HTTPException(status_code=404, detail="Dispute not found.")
    if dispute.status in {DisputeStatus.RESOLVED.value, DisputeStatus.CLOSED.value}:
        raise HTTPException(status_code=409, detail="This dispute has already been resolved.")
    now = datetime.now(timezone.utc)
    dispute.resolution = DisputeResolution(payload.resolution).value
    dispute.resolution_notes = payload.notes.strip()
    dispute.status = (
        DisputeStatus.CLOSED.value
        if payload.resolution == DisputeResolution.WITHDRAWN.value
        else DisputeStatus.RESOLVED.value
    )
    dispute.resolved_by_id = admin.id
    dispute.resolved_at = now
    dispute.latest_admin_id = admin.id
    transaction = dispute.transaction
    if any(payment.status == "released" for payment in transaction.payments):
        transaction.status = TransactionStatus.COMPLETED.value
    elif transaction.quantity_received_base is not None:
        transaction.status = TransactionStatus.PAYMENT_PENDING.value
    elif transaction.handover_at is not None:
        transaction.status = TransactionStatus.IN_TRANSIT.value
    else:
        transaction.status = TransactionStatus.PENDING_HANDOVER.value

    for recipient_id in {transaction.buyer_id, transaction.supplier_id}:
        create_notification(
            db,
            user_id=recipient_id,
            notification_type=NotificationType.DISPUTE.value,
            title="Your transaction dispute was resolved",
            body=f"An administrator resolved dispute {dispute.id}: {dispute.resolution}.",
            link=f"/disputes/{dispute.id}",
            meta={
                "dispute_id": dispute.id,
                "transaction_id": transaction.id,
                "resolution": dispute.resolution,
            },
        )
    db.commit()
    return _dispute_out(dispute, transaction)
