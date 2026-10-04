from ..database import SessionLocal, init_db
from ..services.catalog import seed_catalog


def main() -> None:
    init_db()
    with SessionLocal() as db:
        seed_catalog(db)


if __name__ == "__main__":
    main()
