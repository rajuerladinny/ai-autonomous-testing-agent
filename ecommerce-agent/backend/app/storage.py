"""SQLAlchemy storage; use PostgreSQL in deployment, SQLite for local development."""
import os
from sqlalchemy import create_engine, String, Integer, Boolean
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./ecommerce.db")
engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(bind=engine)

class Base(DeclarativeBase):
    pass

class StoredOrder(Base):
    __tablename__ = "ecommerce_orders"
    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    days_pending: Mapped[int] = mapped_column(Integer, nullable=False)
    acknowledged: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

def init_db():
    Base.metadata.create_all(bind=engine)
