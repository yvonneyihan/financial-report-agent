"""PDF parser — extracts raw text and tables from financial report PDFs."""

from pathlib import Path

import pdfplumber
import pandas as pd
from pdfplumber.page import Page


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
