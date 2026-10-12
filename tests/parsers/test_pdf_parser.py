"""Tests for the page-aware parser ``parse_pdf_pages``.

Uses the synthetic fixture ``tests/fixtures/acme_annual_report_fy2024.pdf``
(regenerate with ``tests/fixtures/make_sample_report.py``).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from src.parsers import PDFReadError, parse_pdf, parse_pdf_pages

FIXTURE = Path(__file__).parent.parent / "fixtures" / "acme_annual_report_fy2024.pdf"


def test_pages_are_numbered_from_one():
    doc = parse_pdf_pages(FIXTURE)
    assert doc.page_count == 4
    assert [p.page_number for p in doc.pages] == [1, 2, 3, 4]


def test_ruled_table_is_detected_and_removed_from_text():
    doc = parse_pdf_pages(FIXTURE)
    income = doc.pages[2]
    assert len(income.tables) == 1
    table = income.tables[0]
    assert table.page_number == 3
    assert table.rows[0][1:] == ["Year ended Dec 31, 2024", "Year ended Dec 31, 2023"]
    assert ["Revenue", "1,120", "1,000"] in table.rows
    # Table cells must not be duplicated into the prose text.
    assert "1,120" not in income.text
    assert "Consolidated Statements of Income" in income.text


def test_borderless_table_stays_in_text_with_values_on_label_line():
    """Documents the known limitation (plan risk R1): borderless tables are not detected."""
    doc = parse_pdf_pages(FIXTURE)
    balance = doc.pages[3]
    assert balance.tables == []
    assert "Total assets 2,400 2,100" in balance.text


def test_prose_page_has_text_and_no_tables():
    doc = parse_pdf_pages(FIXTURE)
    assert "Revenue increased 12%" in doc.pages[1].text
    assert doc.pages[1].tables == []


def test_legacy_parse_pdf_is_unchanged():
    legacy = parse_pdf(FIXTURE)
    assert set(legacy) == {"text", "tables"}
    assert "Acme" in legacy["text"] or "ACME" in legacy["text"]


def test_missing_file_raises():
    with pytest.raises(FileNotFoundError):
        parse_pdf_pages(Path("/nonexistent/report.pdf"))


def test_non_pdf_extension_raises(tmp_path: Path):
    f = tmp_path / "notes.txt"
    f.write_text("hello")
    with pytest.raises(ValueError):
        parse_pdf_pages(f)


def test_corrupt_pdf_raises_pdf_read_error(tmp_path: Path):
    f = tmp_path / "broken.pdf"
    f.write_bytes(b"%PDF-1.4\nthis is not a real pdf")
    with pytest.raises(PDFReadError):
        parse_pdf_pages(f)
