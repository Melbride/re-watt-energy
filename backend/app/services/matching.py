from __future__ import annotations

from decimal import Decimal

from ..models import BuyerRequirement, Listing
from .units import are_compatible, to_base


def compatible_listings(
    requirement: BuyerRequirement, listings: list[Listing]
) -> list[Listing]:
    acceptable = {condition.lower() for condition in requirement.acceptable_conditions}
    counties = {county.casefold() for county in requirement.delivery_counties}
    candidates = []
    for listing in listings:
        if listing.status not in {"active", "partially_allocated"} or listing.quantity_available_base <= 0:
            continue
        if listing.material_id != requirement.material_id:
            continue
        if not are_compatible(listing.unit, requirement.unit):
            continue
        if acceptable and listing.condition.lower() not in acceptable:
            continue
        if counties and (not listing.county or listing.county.casefold() not in counties):
            continue
        if (
            requirement.required_by is not None
            and listing.available_from is not None
            and listing.available_from > requirement.required_by
        ):
            continue
        if (
            requirement.target_price_per_unit is not None
            and listing.price_per_unit is not None
        ):
            if listing.currency.upper() != requirement.currency.upper():
                continue
            supplier_unit_base = to_base(1, listing.unit)
            buyer_unit_base = to_base(1, requirement.unit)
            price_in_requirement_unit = (
                Decimal(listing.price_per_unit) * buyer_unit_base / supplier_unit_base
            )
            if price_in_requirement_unit > requirement.target_price_per_unit:
                continue
        candidates.append(listing)

    # Prefer the buyer's delivery counties, then allocate the least fragmented
    # offer first to make the resulting supplier breakdown easy to act on.
    candidates.sort(
        key=lambda listing: (
            0 if listing.county and listing.county.casefold() in counties else 1,
            -Decimal(listing.quantity_available_base),
            listing.id,
        )
    )
    return candidates


def allocate_supply(requirement: BuyerRequirement, candidates: list[Listing]) -> list[dict]:
    remaining = Decimal(requirement.quantity_base)
    allocation = []
    for listing in candidates:
        if remaining <= 0:
            break
        quantity = min(Decimal(listing.quantity_available_base), remaining)
        if quantity <= 0:
            continue
        allocation.append({"listing": listing, "quantity_base": quantity})
        remaining -= quantity
    return allocation
