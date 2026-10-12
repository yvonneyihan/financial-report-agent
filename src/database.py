"""Database setup — SQLAlchemy models and session management for PostgreSQL.

Tables:
- reports          : one row per uploaded financial report
- analysis_results : one row per completed pipeline run (linked to a report)

The DATABASE_URL env var must point to a PostgreSQL instance, e.g.:
  postgresql://user:password@localhost:5432/financial_agent
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
)
from sqlalchemy.orm import DeclarativeBase, Session, relationship, sessionmaker


# ---------------------------------------------------------------------------
# Engine / session factory
# ---------------------------------------------------------------------------


def _get_database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL environment variable is not set.")
    return url


def get_engine():
    return create_engine(_get_database_url(), pool_pre_ping=True)


def get_session_factory(engine=None):
    if engine is None:
        engine = get_engine()
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


# ---------------------------------------------------------------------------
# ORM models
# ---------------------------------------------------------------------------


class Base(DeclarativeBase):
    pass


class Report(Base):
    """Tracks an uploaded financial report file."""

    __tablename__ = "reports"

    id: int = Column(Integer, primary_key=True, autoincrement=True)
    filename: str = Column(String(255), nullable=False)
    company_name: str = Column(String(255), nullable=True)
    report_period: str = Column(String(50), nullable=True)
    uploaded_at: datetime = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    raw_text: str = Column(Text, nullable=True)

    results = relationship("AnalysisResult", back_populates="report", cascade="all, delete-orphan")


class AnalysisResult(Base):
    """Stores the full pipeline output for one report."""

    __tablename__ = "analysis_results"

    id: int = Column(Integer, primary_key=True, autoincrement=True)
    report_id: int = Column(Integer, ForeignKey("reports.id"), nullable=False)
    created_at: datetime = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Extracted figures (20 fields) stored as JSON for flexibility
    extracted_financials: dict = Column(JSON, nullable=True)

    # Computed ratios dict (gross_margin, net_margin, D/E, etc.)
    computed_ratios: dict = Column(JSON, nullable=True)

    # Claude-generated outputs
    narrative: str = Column(Text, nullable=True)
    risk_flags: dict = Column(JSON, nullable=True)      # serialised RiskFlagReport
    overall_risk_level: str = Column(String(10), nullable=True)

    report = relationship("Report", back_populates="results")


# ---------------------------------------------------------------------------
# Schema initialisation
# ---------------------------------------------------------------------------


def create_tables(engine=None) -> None:
    """Create all tables if they do not already exist."""
    if engine is None:
        engine = get_engine()
    Base.metadata.create_all(engine)
