"""Pydantic models for page-aware PDF parsing output.

These cross the parser → HTTP boundary (consumed by the TypeScript server),
so they are explicit and validated rather than raw dicts / DataFrames.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ParsedTable(BaseModel):
    """A table detected by pdfplumber on a single page."""

    page_number: int = Field(..., ge=1, description="1-indexed page the table appears on")
    rows: list[list[str]] = Field(
        ..., description="Cell text, row-major. Row 0 is the header row as it appears in the PDF."
    )


class ParsedPage(BaseModel):
    """Text and tables for one PDF page."""

    page_number: int = Field(..., ge=1, description="1-indexed page number")
    text: str = Field(
        ...,
        description=(
            "Page text with regions covered by detected tables removed, so table "
            "content is not duplicated between `text` and `tables`."
        ),
    )
    tables: list[ParsedTable] = Field(default_factory=list)


class ParsedDocument(BaseModel):
    """Page-aware parse of a whole PDF."""

    page_count: int = Field(..., ge=0)
    pages: list[ParsedPage]
