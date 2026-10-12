"""PDF parser — extracts raw text and tables from financial report PDFs."""

from pathlib import Path

import re

import pdfplumber
import pandas as pd
from pdfplumber.page import Page

from .models import ParsedDocument, ParsedPage, ParsedTable


class PDFReadError(IOError):
    """Raised when a PDF cannot be opened or read."""


def parse_pdf(path: Path) -> dict:
    """Parse a PDF and return a dict with keys ``text`` and ``tables``.

    Args:
        path: Path to the PDF file.

    Returns:
        ``{"text": str, "tables": list[pd.DataFrame]}``

        - ``text``: full document text, pages joined with ``\\n\\n``.
        - ``tables``: list of DataFrames extracted from the document.
          Adjacent pages whose tables share identical column headers are
          stitched into a single DataFrame (multi-page table handling).

    Raises:
        FileNotFoundError: if ``path`` does not exist.
        ValueError: if ``path`` is not a ``.pdf`` file.
        PDFReadError: if pdfplumber cannot open or read the file.
    """
    if not path.exists():
        raise FileNotFoundError(f"PDF not found: {path}")
    if path.suffix.lower() != ".pdf":
        raise ValueError(f"Expected a .pdf file, got: {path.suffix}")

    page_texts: list[str] = []
    # Each entry is a list of DataFrames found on one page.
    per_page_tables: list[list[pd.DataFrame]] = []

    try:
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                page_texts.append(page.extract_text() or "")
                per_page_tables.append(_tables_from_page(page))
    except PDFReadError:
        raise
    except Exception as exc:
        raise PDFReadError(f"Could not read {path}: {exc}") from exc

    text = "\n\n".join(t for t in page_texts if t)
    tables = _stitch_tables(per_page_tables)

    return {"text": text, "tables": tables}


def parse_pdf_pages(path: Path) -> ParsedDocument:
    """Parse a PDF page by page, preserving page numbers.

    Unlike :func:`parse_pdf` (which joins all pages), this keeps per-page text
    and tables so downstream retrieval can cite page numbers.  Text belonging
    to a detected table is excluded from ``ParsedPage.text`` to avoid
    duplicating table content.

    Note: pdfplumber's default table detection relies on ruling lines, so
    borderless tables (common in SEC filings) remain in ``text``.  Callers
    that care about table structure must handle that case.

    Raises:
        FileNotFoundError: if ``path`` does not exist.
        ValueError: if ``path`` is not a ``.pdf`` file.
        PDFReadError: if pdfplumber cannot open or read the file.
    """
    if not path.exists():
        raise FileNotFoundError(f"PDF not found: {path}")
    if path.suffix.lower() != ".pdf":
        raise ValueError(f"Expected a .pdf file, got: {path.suffix}")

    pages: list[ParsedPage] = []
    try:
        with pdfplumber.open(path) as pdf:
            for index, page in enumerate(pdf.pages, start=1):
                pages.append(_parse_page(page, index))
    except Exception as exc:
        raise PDFReadError(f"Could not read {path}: {exc}") from exc

    return ParsedDocument(page_count=len(pages), pages=pages)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _tables_from_page(page: Page) -> list[pd.DataFrame]:
    """Extract all tables from a single page as DataFrames.

    The first non-empty row is promoted to column headers.  Tables with
    fewer than two rows (header + at least one data row) are dropped.
    """
    frames: list[pd.DataFrame] = []
    for raw in page.extract_tables() or []:
        if not raw or len(raw) < 2:
            continue
        headers = [str(c) if c is not None else "" for c in raw[0]]
        rows = [[str(c) if c is not None else "" for c in row] for row in raw[1:]]
        frames.append(pd.DataFrame(rows, columns=headers))
    return frames


def _stitch_tables(per_page: list[list[pd.DataFrame]]) -> list[pd.DataFrame]:
    """Merge tables that span multiple pages.

    Strategy: when the first table on page N+1 has exactly the same
    column names as the last table on page N, treat them as a single
    continued table and concatenate their rows.  All other tables are
    kept as-is.
    """
    # Flatten to a sequence of (df, page_index, table_index) tuples so we
    # can compare neighbours across page boundaries.
    flat: list[pd.DataFrame] = []
    for page_tables in per_page:
        flat.extend(page_tables)

    if not flat:
        return []

    stitched: list[pd.DataFrame] = [flat[0]]
    for df in flat[1:]:
        prev = stitched[-1]
        if list(df.columns) == list(prev.columns):
            # Same schema — concatenate and replace the last entry.
            stitched[-1] = pd.concat([prev, df], ignore_index=True)
        else:
            stitched.append(df)

    return stitched


def _parse_page(page: Page, page_number: int) -> ParsedPage:
    """Split one page into non-table text and detected tables."""
    found = page.find_tables()
    tables: list[ParsedTable] = []
    text_page = page
    for table in found:
        rows = _clean_rows(table.extract())
        if len(rows) >= 2:
            tables.append(ParsedTable(page_number=page_number, rows=rows))
        # Remove the table region from the prose text even if the table was
        # too small to keep, so its cells do not leak into `text`.
        text_page = text_page.outside_bbox(table.bbox)

    text = text_page.extract_text() or ""
    return ParsedPage(page_number=page_number, text=text.strip(), tables=tables)


def _clean_rows(raw: list[list[str | None]]) -> list[list[str]]:
    """Normalise cell text (None → "", collapse whitespace) and drop empty rows."""
    rows: list[list[str]] = []
    for row in raw or []:
        cells = [re.sub(r"\s+", " ", c).strip() if c is not None else "" for c in row]
        if any(cells):
            rows.append(cells)
    return rows
