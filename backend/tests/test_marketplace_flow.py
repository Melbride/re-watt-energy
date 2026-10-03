from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import database, main
from app.models import Base, User
from app.security import hash_password


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_sessions = sessionmaker(
        bind=engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )
    monkeypatch.setattr(database, "SessionLocal", testing_sessions)
    monkeypatch.setattr(main, "SessionLocal", testing_sessions)
    monkeypatch.setattr(main, "init_db", lambda: Base.metadata.create_all(bind=engine))
    with TestClient(main.app) as test_client:
        with testing_sessions() as db:
            db.add(
                User(
                    email="admin@example.com",
                    password_hash=hash_password("safe-admin-password-123"),
                    full_name="Test Admin",
                    role="admin",
                    status="active",
                    is_active=True,
                )
            )
            db.commit()
        yield test_client
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def register(
    client: TestClient,
    *,
    email: str,
    role: str,
    business_name: str,
    supplier_type: str | None = None,
) -> tuple[str, dict]:
    payload = {
        "email": email,
        "password": "safe-demo-password-123",
        "full_name": business_name,
        "role": role,
        "business_name": business_name,
        "supplier_type": supplier_type,
        "county": "Kiambu",
    }
    response = client.post("/api/auth/register", json=payload)
    assert response.status_code == 201, response.text
    body = response.json()
    return body["access_token"], body["user"]


def test_health_catalog_and_registration(client: TestClient) -> None:
    assert client.get("/health").json()["status"] == "ok"
    catalog = client.get("/api/catalog")
    assert catalog.status_code == 200
    materials = catalog.json()[0]["materials"]
    assert any(material["slug"] == "maize-cobs" for material in materials)

    token, user = register(
        client,
        email="supplier@example.com",
        role="supplier",
        business_name="Green Farm",
        supplier_type="farmer",
    )
    assert user["role"] == "supplier"
    user_notifications = client.get(
        "/api/notifications",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert user_notifications.status_code == 200
    assert user_notifications.json()[0]["title"] == "Welcome to Re-Watt"
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200
    duplicate = client.post(
        "/api/auth/register",
        json={
            "email": "supplier@example.com",
            "password": "safe-demo-password-123",
            "full_name": "Another Supplier",
            "role": "supplier",
            "business_name": "Second Farm",
            "supplier_type": "farmer",
        },
    )
    assert duplicate.status_code == 409


def test_unverified_supplier_cannot_publish(client: TestClient) -> None:
    token, _ = register(
        client,
        email="pending@example.com",
        role="supplier",
        business_name="Pending Farm",
        supplier_type="farmer",
    )
    material_id = client.get("/api/catalog").json()[0]["materials"][0]["id"]
    response = client.post(
        "/api/listings",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "material_id": material_id,
            "title": "Dry maize cobs",
            "condition": "dry",
            "quantity": 500,
            "unit": "kg",
        },
    )
    assert response.status_code == 403


def test_notification_read_endpoints_are_user_scoped(client: TestClient) -> None:
    buyer_token, buyer = register(
        client,
        email="notifications-buyer@example.com",
        role="buyer",
        business_name="Notifications Buyer",
    )
    supplier_token, _ = register(
        client,
        email="notifications-supplier@example.com",
        role="supplier",
        business_name="Notifications Supplier",
        supplier_type="farmer",
    )

    buyer_notifications = client.get(
        "/api/notifications",
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    supplier_notifications = client.get(
        "/api/notifications",
        headers={"Authorization": f"Bearer {supplier_token}"},
    )
    assert buyer_notifications.status_code == 200
    assert supplier_notifications.status_code == 200
    buyer_welcome = buyer_notifications.json()[0]
    supplier_welcome = supplier_notifications.json()[0]
    assert buyer_welcome["type"] == "system"
    assert buyer_welcome["meta"] == {"user_id": buyer["id"]}
    assert supplier_welcome["type"] == "system"

    assert client.post(
        f"/api/notifications/{buyer_welcome['id']}/read",
        headers={"Authorization": f"Bearer {supplier_token}"},
    ).status_code == 404
    read_one = client.post(
        f"/api/notifications/{buyer_welcome['id']}/read",
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    assert read_one.status_code == 200
    assert read_one.json()["read_at"] is not None

    read_all = client.post(
        "/api/notifications/read-all",
        headers={"Authorization": f"Bearer {supplier_token}"},
    )
    assert read_all.status_code == 200
    assert read_all.json()["updated_count"] == 1
    assert all(
        notification["read_at"] is not None
        for notification in client.get(
            "/api/notifications",
            headers={"Authorization": f"Bearer {supplier_token}"},
        ).json()
    )


def test_buyer_must_be_verified_before_posting_requirement(client: TestClient) -> None:
    buyer_token, buyer = register(
        client,
        email="unverified-buyer@example.com",
        role="buyer",
        business_name="Unverified Buyer",
    )
    material_id = client.get("/api/catalog").json()[0]["materials"][0]["id"]
    requirement_payload = {
        "material_id": material_id,
        "title": "Maize cobs for processing",
        "quantity": 100,
        "unit": "kg",
        "acceptable_conditions": ["dry"],
        "delivery_counties": ["Kiambu"],
    }
    pending_response = client.post(
        "/api/requirements",
        headers={"Authorization": f"Bearer {buyer_token}"},
        json=requirement_payload,
    )
    assert pending_response.status_code == 403
    assert "Buyer verification is required" in pending_response.json()["detail"]

    admin_login = client.post(
        "/api/auth/login",
        json={"email": "admin@example.com", "password": "safe-admin-password-123"},
    )
    admin_token = admin_login.json()["access_token"]
    decision = client.patch(
        f"/api/admin/verifications/{buyer['id']}",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"decision": "verified"},
    )
    assert decision.status_code == 200, decision.text
    verified_response = client.post(
        "/api/requirements",
        headers={"Authorization": f"Bearer {buyer_token}"},
        json=requirement_payload,
    )
    assert verified_response.status_code == 201, verified_response.text


def test_aggregated_match_supplier_acceptance_and_transaction(client: TestClient) -> None:
    buyer_token, buyer = register(
        client,
        email="buyer@example.com",
        role="buyer",
        business_name="Briquette Works",
    )
    first_token, first = register(
        client,
        email="first@example.com",
        role="supplier",
        business_name="First Farm",
        supplier_type="farmer",
    )
    second_token, second = register(
        client,
        email="second@example.com",
        role="supplier",
        business_name="Second Farm",
        supplier_type="farmer",
    )

    admin_login = client.post(
        "/api/auth/login",
        json={"email": "admin@example.com", "password": "safe-admin-password-123"},
    )
    admin_token = admin_login.json()["access_token"]
    admin_notifications = client.get(
        "/api/notifications",
        headers={"Authorization": f"Bearer {admin_token}"},
    ).json()
    assert any(
        notification["meta"].get("user_id") == first["id"]
        for notification in admin_notifications
    )
    pending = client.get(
        "/api/admin/verifications/pending",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    # Both suppliers are pending; the buyer was also created and is pending
    pending_suppliers = {
        entry["user_id"]
        for entry in pending.json()
        if entry.get("role") == "supplier"
    }
    assert pending_suppliers == {first["id"], second["id"]}
    for supplier_id in (first["id"], second["id"]):
        verified = client.patch(
            f"/api/admin/verifications/{supplier_id}",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"decision": "verified"},
        )
        assert verified.status_code == 200, verified.text
    admin_login = client.post(
        "/api/auth/login",
        json={"email": "admin@example.com", "password": "safe-admin-password-123"},
    )
    admin_token = admin_login.json()["access_token"]
    buyer_verified = client.patch(
        f"/api/admin/verifications/{buyer['id']}",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"decision": "verified"},
    )
    assert buyer_verified.status_code == 200, buyer_verified.text
    verified_notifications = client.get(
        "/api/notifications",
        headers={"Authorization": f"Bearer {first_token}"},
    ).json()
    assert any(
        notification["type"] == "verification"
        and notification["meta"]["status"] == "active"
        for notification in verified_notifications
    )

    catalog = client.get("/api/catalog").json()
    maize = next(material for item in catalog for material in item["materials"] if material["slug"] == "maize-cobs")
    for token, amount in ((first_token, 500), (second_token, 800)):
        response = client.post(
            "/api/listings",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "material_id": maize["id"],
                "title": "Dry maize cobs",
                "condition": "dry",
                "quantity": amount,
                "unit": "kg",
                "price_per_unit": 10,
                "county": "Kiambu",
            },
        )
        assert response.status_code == 201, response.text

    requirement_response = client.post(
        "/api/requirements",
        headers={"Authorization": f"Bearer {buyer_token}"},
        json={
            "material_id": maize["id"],
            "title": "Maize cobs for briquettes",
            "quantity": 1100,
            "unit": "kg",
            "acceptable_conditions": ["dry"],
            "delivery_counties": ["Kiambu"],
            "currency": "KES",
        },
    )
    assert requirement_response.status_code == 201, requirement_response.text
    requirement_id = requirement_response.json()["id"]
    match_response = client.post(
        f"/api/requirements/{requirement_id}/matches",
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    assert match_response.status_code == 201, match_response.text
    match = match_response.json()
    assert match["supplier_count"] == 2
    assert match["coverage_percent"] == 100
    assert match["matched_quantity"] == 1100
    assert sum(float(item["quantity"]) for item in match["items"]) == 1100

    assert client.post(
        f"/api/matches/{match['id']}/respond",
        headers={"Authorization": f"Bearer {first_token}"},
        json={"accept": True},
    ).json()["status"] == "partially_accepted"
    accepted = client.post(
        f"/api/matches/{match['id']}/respond",
        headers={"Authorization": f"Bearer {second_token}"},
        json={"accept": True},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "confirmed"
    transaction_list = client.get(
        "/api/transactions",
        headers={"Authorization": f"Bearer {buyer_token}"},
    ).json()
    assert len(transaction_list) == 2
    first_transaction = transaction_list[0]
    supplier_token = first_token if first_transaction["supplier_id"] == first["id"] else second_token
    handover = client.post(
        f"/api/transactions/{first_transaction['id']}/handover",
        headers={"Authorization": f"Bearer {supplier_token}"},
        json={"notes": "Collected by the buyer's carrier", "evidence": {"reference": "HANDOVER-1"}},
    )
    assert handover.status_code == 200, handover.text
    assert handover.json()["status"] == "in_transit"
    assert handover.json()["id"] == first_transaction["id"]
    assert handover.json()["material"] == first_transaction["material"]
    assert handover.json()["payments"] == first_transaction["payments"]
    assert handover.json()["evidence"] == {"reference": "HANDOVER-1"}
    other_supplier_token = second_token if supplier_token == first_token else first_token
    assert client.post(
        f"/api/transactions/{first_transaction['id']}/handover",
        headers={"Authorization": f"Bearer {other_supplier_token}"},
        json={},
    ).status_code == 404
    assert client.post(
        f"/api/transactions/{first_transaction['id']}/handover",
        headers={"Authorization": f"Bearer {supplier_token}"},
        json={},
    ).status_code == 409
    buyer_notifications = client.get(
        "/api/notifications",
        headers={"Authorization": f"Bearer {buyer_token}"},
    ).json()
    assert any(
        notification["meta"].get("transaction_id") == first_transaction["id"]
        and notification["title"] == "Supplier handed over your material"
        for notification in buyer_notifications
    )
    buyer_handover_notification = next(
        notification
        for notification in buyer_notifications
        if notification["meta"].get("transaction_id") == first_transaction["id"]
        and notification["title"] == "Supplier handed over your material"
    )
    supplier_notifications = client.get(
        "/api/notifications",
        headers={"Authorization": f"Bearer {supplier_token}"},
    ).json()
    assert all(item["id"] != buyer_handover_notification["id"] for item in supplier_notifications)
    assert client.post(
        f"/api/notifications/{buyer_handover_notification['id']}/read",
        headers={"Authorization": f"Bearer {supplier_token}"},
    ).status_code == 404
    receipt = client.post(
        f"/api/transactions/{first_transaction['id']}/confirm-receipt",
        headers={"Authorization": f"Bearer {buyer_token}"},
        json={"quantity_received": first_transaction["quantity_declared"]},
    )
    assert receipt.status_code == 200
    payment = client.post(
        f"/api/transactions/{first_transaction['id']}/payments",
        headers={"Authorization": f"Bearer {buyer_token}"},
        json={"method": "mobile_money", "reference": "DEMO-123"},
    )
    assert payment.status_code == 201
    payee_token = first_token if first_transaction["supplier_id"] == first["id"] else second_token
    confirmed = client.post(
        f"/api/payments/{payment.json()['id']}/confirm-received",
        headers={"Authorization": f"Bearer {payee_token}"},
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["transaction_status"] == "completed"

    opened = client.post(
        f"/api/transactions/{first_transaction['id']}/disputes",
        headers={"Authorization": f"Bearer {buyer_token}"},
        json={
            "reason": "Received quantity differs",
            "message": "Please review the delivery evidence.",
            "claim_quantity": first_transaction["quantity_declared"],
        },
    )
    assert opened.status_code == 201, opened.text
    dispute = opened.json()
    assert dispute["status"] == "open"
    assert dispute["buyer_claim_quantity"] == first_transaction["quantity_declared"]
    assert dispute["transaction_status"] == "disputed"
    assert dispute["material"] == first_transaction["material"]
    assert dispute["supplier_id"] == first_transaction["supplier_id"]
    assert dispute["buyer_id"] == first_transaction["buyer_id"]
    assert len(dispute["messages"]) == 1
    assert dispute["messages"][0]["author_name"] == "Briquette Works"
    assert client.get(
        "/api/disputes",
        headers={"Authorization": f"Bearer {buyer_token}"},
    ).json()[0]["id"] == dispute["id"]

    supplier_message = client.post(
        f"/api/disputes/{dispute['id']}/messages",
        headers={"Authorization": f"Bearer {supplier_token}"},
        json={"body": "We provided the full declared quantity."},
    )
    assert supplier_message.status_code == 201, supplier_message.text
    assert supplier_message.json()["author_id"] == first_transaction["supplier_id"]
    assert supplier_message.json()["body"] == "We provided the full declared quantity."
    assert supplier_message.json()["author_name"] in {"First Farm", "Second Farm"}
    serialized_dispute = client.get(
        f"/api/disputes/{dispute['id']}",
        headers={"Authorization": f"Bearer {buyer_token}"},
    ).json()
    assert serialized_dispute["transaction_status"] == "disputed"
    assert serialized_dispute["material"] == first_transaction["material"]
    assert serialized_dispute["supplier_id"] == first_transaction["supplier_id"]
    assert serialized_dispute["buyer_id"] == first_transaction["buyer_id"]
    assert serialized_dispute["messages"][-1]["author_name"] in {"First Farm", "Second Farm"}
    assert client.get(
        f"/api/disputes/{dispute['id']}",
        headers={"Authorization": f"Bearer {buyer_token}"},
    ).json()["messages"][-1]["body"] == "We provided the full declared quantity."

    unrelated_supplier_token = (
        second_token if first_transaction["supplier_id"] == first["id"] else first_token
    )
    assert client.get(
        f"/api/disputes/{dispute['id']}",
        headers={"Authorization": f"Bearer {unrelated_supplier_token}"},
    ).status_code == 404

    role_scoped_disputes = client.get(
        "/api/disputes",
        headers={"Authorization": f"Bearer {unrelated_supplier_token}"},
    )
    assert role_scoped_disputes.status_code == 200
    assert all(item["transaction_id"] != first_transaction["id"] for item in role_scoped_disputes.json())
    assert client.get(
        f"/api/disputes/{dispute['id']}",
        headers={"Authorization": f"Bearer {unrelated_supplier_token}"},
    ).status_code == 404
    assert client.post(
        f"/api/transactions/{first_transaction['id']}/disputes",
        headers={"Authorization": f"Bearer {unrelated_supplier_token}"},
        json={"reason": "Not this supplier's transaction"},
    ).status_code == 404

    admin_disputes = client.get(
        "/api/admin/disputes",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert admin_disputes.status_code == 200
    assert any(item["id"] == dispute["id"] for item in admin_disputes.json())
    assert client.patch(
        f"/api/disputes/{dispute['id']}/resolve",
        headers={"Authorization": f"Bearer {buyer_token}"},
        json={"resolution": "split", "notes": "Buyer cannot resolve."},
    ).status_code == 403
    resolution = client.patch(
        f"/api/disputes/{dispute['id']}/resolve",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"resolution": "split", "notes": "Parties agreed to a split resolution."},
    )
    assert resolution.status_code == 200, resolution.text
    assert resolution.json()["status"] == "resolved"
    assert resolution.json()["resolution"] == "split"
    assert client.patch(
        f"/api/disputes/{dispute['id']}/resolve",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"resolution": "full_buyer", "notes": "Duplicate resolution"},
    ).status_code == 409

    notifications = client.get(
        "/api/notifications",
        headers={"Authorization": f"Bearer {buyer_token}"},
    ).json()
    unread_dispute_notification = next(
        notification
        for notification in notifications
        if notification["meta"].get("dispute_id") == dispute["id"]
        and notification["title"] == "Your transaction dispute was resolved"
    )
    marked_read = client.post(
        f"/api/notifications/{unread_dispute_notification['id']}/read",
        headers={"Authorization": f"Bearer {buyer_token}"},
    )
    assert marked_read.status_code == 200
    assert marked_read.json()["read_at"] is not None
    assert client.post(
        f"/api/notifications/{unread_dispute_notification['id']}/read",
        headers={"Authorization": f"Bearer {buyer_token}"},
    ).status_code == 200
