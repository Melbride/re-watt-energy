from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Category, Material

DEFAULT_CATALOG = (
    {
        "slug": "agricultural-residues",
        "name": "Agricultural residues",
        "description": "Useful agricultural by-products and biomass feedstock.",
        "materials": (
            {
                "slug": "maize-cobs",
                "name": "Maize cobs",
                "description": "Maize cobs for biomass processing and other productive uses.",
                "typical_conditions": ["dry", "mixed", "wet"],
                "typical_units": ["kg", "tonne", "bag"],
                "primary_uses": ["Briquettes", "Pellets", "Biomass fuel"],
                "buyer_types": ["Biomass processors", "Briquette producers", "Pellet processors"],
                "quality_notes": "Dry, clean material is generally preferred. Condition should be confirmed at handover.",
            },
            {
                "slug": "maize-stover",
                "name": "Maize stover",
                "description": "Stalks, leaves, and husks remaining after maize harvest.",
                "typical_conditions": ["dry", "mixed", "wet"],
                "typical_units": ["kg", "tonne", "bale"],
                "primary_uses": ["Animal feed", "Composting", "Biomass fuel"],
                "buyer_types": ["Feed producers", "Composters", "Biomass processors"],
                "quality_notes": "Keep material free from plastics and other contaminants.",
            },
        ),
    },
)


def seed_catalog(db: Session) -> None:
    for category_data in DEFAULT_CATALOG:
        category = db.scalar(select(Category).where(Category.slug == category_data["slug"]))
        if category is None:
            category = Category(
                slug=category_data["slug"],
                name=category_data["name"],
                description=category_data["description"],
                sort_order=0,
                is_active=True,
            )
            db.add(category)
            db.flush()
        for material_data in category_data["materials"]:
            material = db.scalar(
                select(Material).where(
                    Material.category_id == category.id,
                    Material.slug == material_data["slug"],
                )
            )
            if material is None:
                db.add(Material(category_id=category.id, **material_data))
    db.commit()
