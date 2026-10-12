"""Generate the synthetic sample annual report used by parser / ingestion tests.

The company, tickers and every number are FICTIONAL.  Figures are internally
consistent (gross profit = revenue - cost of revenue; assets = liabilities +
equity) so calculation tests can rely on them.

Regenerate with (needs ``reportlab``, see requirements-dev.txt):

    python tests/fixtures/make_sample_report.py
"""

from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.platypus import Table, TableStyle

OUT = Path(__file__).parent / "acme_annual_report_fy2024.pdf"
WIDTH, HEIGHT = letter


def _cover(c: canvas.Canvas) -> None:
    c.setFont("Helvetica-Bold", 20)
    c.drawString(72, HEIGHT - 120, "ACME CORPORATION")
    c.setFont("Helvetica", 12)
    y = HEIGHT - 160
    for line in [
        "ANNUAL REPORT ON FORM 10-K",
        "For the fiscal year ended December 31, 2024",
        "Commission file number 000-00000",
        "(Exact name of registrant as specified in its charter)",
        "Title of each class: Common Stock    Trading Symbol(s): ACME    Exchange: NASDAQ",
        "",
        "SYNTHETIC SAMPLE DOCUMENT - all figures are fictional and for software testing only.",
    ]:
        c.drawString(72, y, line)
        y -= 20
    c.showPage()


def _mdna(c: canvas.Canvas) -> None:
    c.setFont("Helvetica-Bold", 14)
    c.drawString(72, HEIGHT - 90, "Management's Discussion and Analysis")
    c.setFont("Helvetica", 11)
    paragraphs = [
        "Revenue increased 12% to $1,120 million in fiscal 2024 from $1,000 million in fiscal 2023.",
        "The increase was driven primarily by growth in cloud subscriptions and higher average",
        "contract values in the enterprise segment.",
        "",
        "Operating income increased to $224 million in fiscal 2024 from $190 million in fiscal 2023.",
        "The improvement reflected operating leverage on higher revenue and lower marketing",
        "spend as a share of revenue, partially offset by increased research and development",
        "headcount.",
        "",
        "Liquidity and capital resources: we ended the year with $310 million of cash and",
        "cash equivalents and had no borrowings outstanding under our revolving credit facility.",
    ]
    y = HEIGHT - 120
    for line in paragraphs:
        c.drawString(72, y, line)
        y -= 16
    c.showPage()


def _income_statement_ruled(c: canvas.Canvas) -> None:
    """Income statement WITH ruling lines (detectable by pdfplumber)."""
    c.setFont("Helvetica-Bold", 14)
    c.drawString(72, HEIGHT - 90, "Consolidated Statements of Income")
    c.setFont("Helvetica", 10)
    c.drawString(72, HEIGHT - 108, "(In millions, except per share amounts)")
    data = [
        ["", "Year ended Dec 31, 2024", "Year ended Dec 31, 2023"],
        ["Revenue", "1,120", "1,000"],
        ["Cost of revenue", "672", "610"],
        ["Gross profit", "448", "390"],
        ["Operating income", "224", "190"],
        ["Net income", "168", "140"],
        ["Diluted earnings per share ($)", "3.36", "2.80"],
    ]
    table = Table(data, colWidths=[220, 130, 130])
    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
            ]
        )
    )
    w, h = table.wrapOn(c, WIDTH, HEIGHT)
    table.drawOn(c, 72, HEIGHT - 130 - h)
    c.showPage()


def _balance_sheet_borderless(c: canvas.Canvas) -> None:
    """Balance sheet with NO ruling lines - mimics most SEC filings."""
    c.setFont("Helvetica-Bold", 14)
    c.drawString(72, HEIGHT - 90, "Consolidated Balance Sheets")
    c.setFont("Helvetica", 10)
    c.drawString(72, HEIGHT - 108, "(In millions)")
    c.setFont("Helvetica-Bold", 10)
    c.drawString(72, HEIGHT - 135, "As of December 31,")
    c.drawRightString(400, HEIGHT - 135, "2024")
    c.drawRightString(480, HEIGHT - 135, "2023")
    c.setFont("Helvetica", 10)
    rows = [
        ("Cash and cash equivalents", "310", "270"),
        ("Total assets", "2,400", "2,100"),
        ("Total liabilities", "900", "850"),
        ("Total shareholders' equity", "1,500", "1,250"),
        ("Total liabilities and shareholders' equity", "2,400", "2,100"),
    ]
    y = HEIGHT - 155
    for label, cur, prior in rows:
        c.drawString(72, y, label)
        c.drawRightString(400, y, cur)
        c.drawRightString(480, y, prior)
        y -= 16
    c.showPage()


def main() -> None:
    c = canvas.Canvas(str(OUT), pagesize=letter)
    c.setTitle("Acme Corporation FY2024 Annual Report (synthetic)")
    _cover(c)
    _mdna(c)
    _income_statement_ruled(c)
    _balance_sheet_borderless(c)
    c.save()
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
