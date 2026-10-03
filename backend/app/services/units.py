"""Unit handling.

Aggregation across suppliers only makes sense when quantities are comparable, so
every quantity is stored twice: once in the unit the supplier declared (for
display and for invoicing) and once normalised to the base unit of its dimension
(kg, litre, piece). Matching and aggregation run exclusively on base quantities.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

MASS = "mass"
VOLUME = "volume"
COUNT = "count"


@dataclass(frozen=True)
class UnitDefinition:
    code: str
    label: str
    dimension: str
    to_base: Decimal
    display_dp: int


UNIT_DEFINITIONS: dict[str, UnitDefinition] = {
    unit.code: unit
    for unit in (
        UnitDefinition("kg", "Kilogram", MASS, Decimal("1"), 1),
        UnitDefinition("g", "Gram", MASS, Decimal("0.001"), 0),
        UnitDefinition("tonne", "Tonne", MASS, Decimal("1000"), 3),
        UnitDefinition("litre", "Litre", VOLUME, Decimal("1"), 1),
        UnitDefinition("m3", "Cubic metre", VOLUME, Decimal("1000"), 2),
        UnitDefinition("piece", "Piece", COUNT, Decimal("1"), 0),
        UnitDefinition("bag", "Bag", COUNT, Decimal("1"), 0),
        UnitDefinition("bale", "Bale", COUNT, Decimal("1"), 0),
        UnitDefinition("bundle", "Bundle", COUNT, Decimal("1"), 0),
    )
}

UNIT_ALIASES: dict[str, str] = {
    "kg": "kg",
    "kgs": "kg",
    "kilogram": "kg",
    "kilograms": "kg",
    "g": "g",
    "gram": "g",
    "grams": "g",
    "t": "tonne",
    "ton": "tonne",
    "tons": "tonne",
    "tonne": "tonne",
    "tonnes": "tonne",
    "l": "litre",
    "ltr": "litre",
    "litre": "litre",
    "litres": "litre",
    "liter": "litre",
    "liters": "litre",
    "m3": "m3",
    "m^3": "m3",
    "cbm": "m3",
    "pcs": "piece",
    "pc": "piece",
    "piece": "piece",
    "pieces": "piece",
    "unit": "piece",
    "units": "piece",
    "bag": "bag",
    "bags": "bag",
    "sack": "bag",
    "sacks": "bag",
    "bale": "bale",
    "bales": "bale",
    "bundle": "bundle",
    "bundles": "bundle",
}

UNIT_CODES: list[str] = list(UNIT_DEFINITIONS)


def normalise_unit(value: str) -> str:
    key = (value or "").strip().lower()
    return UNIT_ALIASES.get(key, key)


def get_unit(code: str) -> UnitDefinition:
    resolved = normalise_unit(code)
    unit = UNIT_DEFINITIONS.get(resolved)
    if unit is None:
        raise ValueError(f"Unsupported unit: {code!r}")
    return unit


def dimension_of(code: str) -> str:
    return get_unit(code).dimension


def base_unit_for(code: str) -> str:
    return {MASS: "kg", VOLUME: "litre", COUNT: "piece"}[dimension_of(code)]


def to_decimal(value) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:  # pragma: no cover - guard
        raise ValueError(f"Invalid quantity: {value!r}") from exc


def to_base(quantity, unit: str) -> Decimal:
    """Convert a quantity in `unit` to the base unit of its dimension."""
    definition = get_unit(unit)
    return quantise(to_decimal(quantity) * definition.to_base)


def from_base(quantity, unit: str) -> Decimal:
    """Convert a base-dimension quantity into `unit`."""
    definition = get_unit(unit)
    return quantise(to_decimal(quantity) / definition.to_base, definition.display_dp)


def convert(quantity, from_unit: str, to_unit: str) -> Decimal:
    if dimension_of(from_unit) != dimension_of(to_unit):
        raise ValueError(
            f"Cannot convert {from_unit} ({dimension_of(from_unit)}) to "
            f"{to_unit} ({dimension_of(to_unit)})"
        )
    return from_base(to_base(quantity, from_unit), to_unit)


def are_compatible(left: str, right: str) -> bool:
    return dimension_of(left) == dimension_of(right)


def quantise(value: Decimal, dp: int = 4) -> Decimal:
    return Decimal(value).quantize(Decimal(1).scaleb(-dp), rounding=ROUND_HALF_UP)


def format_quantity(quantity, unit: str) -> str:
    definition = get_unit(unit)
    value = quantise(to_decimal(quantity), definition.display_dp)
    return f"{value.normalize():f} {definition.code}"


def as_float(value: Decimal | None) -> float:
    return float(value) if value is not None else 0.0
