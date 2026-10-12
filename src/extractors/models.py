"""Pydantic models for extracted financial data.

These models define the 20 financial figures that the extractor pulls from
raw report text.  They cross the extractor → calculator boundary, so all
fields are typed and validated here.
"""

from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field


class ExtractedFinancials(BaseModel):
    """All financial figures extracted from a single reporting period.

    Monetary values are in millions USD unless a field note says otherwise.
    Any figure the LLM could not locate in the source text is ``None``.
    """

    # ── Identity ────────────────────────────────────────────────────────────
    company_name: str = Field(..., description="Reporting company name")
    report_period: str = Field(
        ..., description="Reporting period label, e.g. 'Q3 2024' or 'FY 2023'"
    )
    report_date: Optional[str] = Field(
        None, description="Period end date in YYYY-MM-DD format if available"
    )

    # ── Income Statement ────────────────────────────────────────────────────
    revenue: Optional[float] = Field(None, description="Total revenue / net sales (millions USD)")
    cost_of_goods_sold: Optional[float] = Field(
        None, description="Cost of goods sold / cost of revenue (millions USD)"
    )
    gross_profit: Optional[float] = Field(None, description="Gross profit (millions USD)")
    operating_expenses: Optional[float] = Field(
        None, description="Total operating expenses excluding COGS (millions USD)"
    )
    operating_income: Optional[float] = Field(
        None, description="Operating income / EBIT (millions USD)"
    )
    ebitda: Optional[float] = Field(
        None, description="Earnings before interest, taxes, depreciation, and amortization (millions USD)"
    )
    interest_expense: Optional[float] = Field(
        None, description="Interest expense (millions USD)"
    )
    net_income: Optional[float] = Field(None, description="Net income / net earnings (millions USD)")

    # ── Per-Share Metrics ───────────────────────────────────────────────────
    eps_basic: Optional[float] = Field(None, description="Basic earnings per share (USD)")
    eps_diluted: Optional[float] = Field(None, description="Diluted earnings per share (USD)")
    shares_outstanding: Optional[float] = Field(
        None, description="Weighted-average diluted shares outstanding (millions)"
    )

    # ── Balance Sheet ───────────────────────────────────────────────────────
    total_assets: Optional[float] = Field(None, description="Total assets (millions USD)")
    total_liabilities: Optional[float] = Field(None, description="Total liabilities (millions USD)")
    total_equity: Optional[float] = Field(
        None, description="Total shareholders' equity (millions USD)"
    )
    long_term_debt: Optional[float] = Field(None, description="Long-term debt (millions USD)")
    cash_and_equivalents: Optional[float] = Field(
        None, description="Cash and cash equivalents (millions USD)"
    )

    # ── Cash Flow ───────────────────────────────────────────────────────────
    free_cash_flow: Optional[float] = Field(
        None,
        description="Free cash flow = operating cash flow minus capex (millions USD)",
    )
