"""End-to-end demo: parse → extract → calculate → analyze a PDF report.

Usage:
    python demo/analyze_report.py --file path/to/report.pdf
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from dotenv import load_dotenv

# Load .env before importing anything that reads env vars
load_dotenv()

from src.analyzers.narrative import generate_narrative
from src.analyzers.risk_flags import analyze_risk
from src.calculators.ratios import compute_all_ratios
from src.extractors.financial_extractor import ExtractionError, extract_financials
from src.parsers.pdf_parser import PDFReadError, parse_pdf


def _fmt_ratio(value: float | None) -> str:
    if value is None:
        return "n/a"
    return f"{value:.2%}" if abs(value) < 10 else f"{value:.2f}x"


def main(pdf_path: Path) -> None:
    print(f"\n=== Financial Report Analysis Agent ===")
    print(f"File: {pdf_path}\n")

    # 1. Parse PDF
    print("Step 1/4  Parsing PDF...")
    try:
        parsed = parse_pdf(pdf_path)
    except (FileNotFoundError, ValueError, PDFReadError) as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"          Extracted {len(parsed['text'])} characters, {len(parsed['tables'])} tables.\n")

    # 2. Extract financial figures via Claude
    print("Step 2/4  Extracting financial figures (Claude)...")
    try:
        financials = extract_financials(parsed["text"])
    except ExtractionError as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"          Company : {financials.company_name}")
    print(f"          Period  : {financials.report_period}")
    print(f"          Revenue : {financials.revenue} M USD")
    print(f"          Net Inc : {financials.net_income} M USD")
    print(f"          EPS Dil : {financials.eps_diluted}\n")

    # 3. Compute ratios (pure Python — no LLM)
    print("Step 3/4  Computing financial ratios...")
    ratios = compute_all_ratios(financials)
    for name, value in ratios.items():
        print(f"          {name:<22} {_fmt_ratio(value)}")
    print()

    # 4. Claude-powered analysis
    print("Step 4/4  Generating narrative and risk flags (Claude)...")
    narrative = generate_narrative(financials, ratios)
    risk_report = analyze_risk(financials, ratios)

    print(f"\n--- Trend Narrative ---")
    print(narrative)

    print(f"\n--- Risk Assessment: {risk_report.overall_risk_level.upper()} ---")
    print(risk_report.summary)
    if risk_report.flags:
        print("\nFlags:")
        for flag in risk_report.flags:
            metric_note = f" [{flag.metric}]" if flag.metric else ""
            print(f"  [{flag.severity.upper()}] {flag.category}{metric_note}: {flag.description}")

    print("\n=== Done ===")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Analyze a financial report PDF end-to-end.")
    parser.add_argument("--file", required=True, type=Path, help="Path to the PDF report.")
    args = parser.parse_args()
    main(args.file)
