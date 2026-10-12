"""FastAPI application — serves the financial report analysis pipeline over HTTP.

Endpoints:
  POST /reports/analyze   Upload a PDF, run the full pipeline, store and return results.
  GET  /reports/{id}      Retrieve a previously stored analysis result.
  GET  /reports           List all stored reports (metadata only).

The pipeline order:
  parse_pdf → extract_financials → compute_all_ratios → generate_narrative + analyze_risk
"""

from __future__ import annotations

import io
import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.analyzers.narrative import generate_narrative
from src.analyzers.risk_flags import analyze_risk
from src.calculators.ratios import compute_all_ratios
from src.database import AnalysisResult, Report, create_tables, get_engine, get_session_factory
from src.extractors.financial_extractor import ExtractionError, extract_financials
from src.parsers.pdf_parser import PDFReadError, parse_pdf

app = FastAPI(
    title="Financial Report Analysis Agent",
    description="AI-powered pipeline for extracting and analyzing financial reports.",
    version="1.0.0",
)

# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------


@app.on_event("startup")
def on_startup() -> None:
    """Ensure database tables exist when the server starts."""
    create_tables()


# ---------------------------------------------------------------------------
# Dependency — database session
# ---------------------------------------------------------------------------


def get_db() -> Session:
    SessionFactory = get_session_factory()
    db = SessionFactory()
    try:
        yield db
    finally:
        db.close()


DbDep = Annotated[Session, Depends(get_db)]

# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class AnalysisResponse(BaseModel):
    report_id: int
    result_id: int
    company_name: str | None
    report_period: str | None
    extracted_financials: dict
    computed_ratios: dict
    narrative: str | None
    risk_flags: dict
    overall_risk_level: str | None


class ReportSummary(BaseModel):
    id: int
    filename: str
    company_name: str | None
    report_period: str | None
    uploaded_at: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.post(
    "/reports/analyze",
    response_model=AnalysisResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a PDF report and run the full analysis pipeline",
)
async def analyze_report(
    file: Annotated[UploadFile, File(description="PDF financial report")],
    db: DbDep,
) -> AnalysisResponse:
    """Run the complete pipeline on an uploaded PDF and persist the results."""

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only PDF files are supported.",
        )

    # 1. Parse PDF → raw text
    contents = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(contents)
        tmp_path = Path(tmp.name)

    try:
        parsed = parse_pdf(tmp_path)
    except (FileNotFoundError, ValueError, PDFReadError) as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    finally:
        tmp_path.unlink(missing_ok=True)

    raw_text: str = parsed["text"]

    # 2. Extract financial figures via Claude
    try:
        financials = extract_financials(raw_text)
    except ExtractionError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    # 3. Compute deterministic ratios (no LLM)
    ratios = compute_all_ratios(financials)

    # 4. Claude-powered analysis
    narrative = generate_narrative(financials, ratios)
    risk_report = analyze_risk(financials, ratios)

    # 5. Persist to PostgreSQL
    report_row = Report(
        filename=file.filename,
        company_name=financials.company_name,
        report_period=financials.report_period,
        raw_text=raw_text,
    )
    db.add(report_row)
    db.flush()  # get report_row.id before creating the result row

    result_row = AnalysisResult(
        report_id=report_row.id,
        extracted_financials=financials.model_dump(),
        computed_ratios=ratios,
        narrative=narrative,
        risk_flags=risk_report.model_dump(),
        overall_risk_level=risk_report.overall_risk_level,
    )
    db.add(result_row)
    db.commit()
    db.refresh(result_row)

    return AnalysisResponse(
        report_id=report_row.id,
        result_id=result_row.id,
        company_name=financials.company_name,
        report_period=financials.report_period,
        extracted_financials=financials.model_dump(),
        computed_ratios=ratios,
        narrative=narrative,
        risk_flags=risk_report.model_dump(),
        overall_risk_level=risk_report.overall_risk_level,
    )


@app.get(
    "/reports/{report_id}",
    response_model=AnalysisResponse,
    summary="Retrieve a stored analysis result by report ID",
)
def get_report(report_id: int, db: DbDep) -> AnalysisResponse:
    """Fetch the most recent analysis result for a given report ID."""
    result = (
        db.query(AnalysisResult)
        .filter(AnalysisResult.report_id == report_id)
        .order_by(AnalysisResult.created_at.desc())
        .first()
    )
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found.")

    return AnalysisResponse(
        report_id=result.report_id,
        result_id=result.id,
        company_name=result.report.company_name,
        report_period=result.report.report_period,
        extracted_financials=result.extracted_financials or {},
        computed_ratios=result.computed_ratios or {},
        narrative=result.narrative,
        risk_flags=result.risk_flags or {},
        overall_risk_level=result.overall_risk_level,
    )


@app.get(
    "/reports",
    response_model=list[ReportSummary],
    summary="List all stored reports",
)
def list_reports(db: DbDep) -> list[ReportSummary]:
    """Return metadata for all stored reports, newest first."""
    rows = db.query(Report).order_by(Report.uploaded_at.desc()).all()
    return [
        ReportSummary(
            id=r.id,
            filename=r.filename,
            company_name=r.company_name,
            report_period=r.report_period,
            uploaded_at=r.uploaded_at.isoformat(),
        )
        for r in rows
    ]
