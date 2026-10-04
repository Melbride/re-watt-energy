from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Notification, User


def create_notification(
    db: Session,
    *,
    user_id: int,
    notification_type: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
    meta: dict | None = None,
) -> Notification:
    notification = Notification(
        user_id=user_id,
        type=notification_type,
        title=title,
        body=body,
        link=link,
        meta=meta,
    )
    db.add(notification)
    return notification


def notify_admins(
    db: Session,
    *,
    notification_type: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
    meta: dict | None = None,
) -> None:
    admin_ids = db.scalars(select(User.id).where(User.role == "admin")).all()
    for admin_id in admin_ids:
        create_notification(
            db,
            user_id=admin_id,
            notification_type=notification_type,
            title=title,
            body=body,
            link=link,
            meta=meta,
        )
