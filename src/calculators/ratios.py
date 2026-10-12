"""Pure financial ratio and metric calculators.

All functions are stateless and side-effect-free.  Inputs come from
:class:`~src.extractors.models.ExtractedFinancials`; outputs are plain dicts
or floats so callers can choose how to structure the results.

No I/O, no API calls, no global state — only arithmetic.
"""

from __future__ import annotations

from typing import Optional

from src.extractors.models import ExtractedFinancials


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _safe_div(numerator: Optional[float], denominator: Optional[float]) -> Optional[float]:
    """Return numerator / denominator, or None if either value is missing/zero."""
    if numerator is None or denominator is None or denominator == 0:
        return None
    return numerator / denominator


# ---------------------------------------------------------------------------
# Margin ratios
# ---------------------------------------------------------------------------


def gross_margin(f: ExtractedFinancials) -> Optional[float]:
    """Gross profit margin = gross_profit / revenue."""
    return _safe_div(f.gross_profit, f.revenue)


def operating_margin(f: ExtractedFinancials) -> Optional[float]:
    """Operating margin = operating_income / revenue."""
    return _safe_div(f.operating_income, f.revenue)


def net_margin(f: ExtractedFinancials) -> Optional[float]:
    """Net profit margin = net_income / revenue."""
    return _safe_div(f.net_income, f.revenue)


def ebitda_margin(f: ExtractedFinancials) -> Optional[float]:
    """EBITDA margin = ebitda / revenue."""
    return _safe_div(f.ebitda, f.revenue)


# ---------------------------------------------------------------------------
# Leverage ratios
# ---------------------------------------------------------------------------


def debt_to_equity(f: ExtractedFinancials) -> Optional[float]:
    """Debt-to-equity ratio = long_term_debt / total_equity."""
    return _safe_div(f.long_term_debt, f.total_equity)


def debt_to_assets(f: ExtractedFinancials) -> Optional[float]:
    """Debt-to-assets ratio = total_liabilities / total_assets."""
    return _safe_div(f.total_liabilities, f.total_assets)


def interest_coverage(f: ExtractedFinancials) -> Optional[float]:
    """Interest coverage ratio = operating_income / interest_expense.

    A ratio below 1.5 is typically considered a warning sign.
    """
    if f.interest_expense is None or f.interest_expense == 0:
        return None
    # interest_expense is stored as a positive number per schema convention
    return _safe_div(f.operating_income, abs(f.interest_expense))


# ---------------------------------------------------------------------------
# Profitability / efficiency
# ---------------------------------------------------------------------------


def return_on_equity(f: ExtractedFinancials) -> Optional[float]:
    """Return on equity = net_income / total_equity."""
    return _safe_div(f.net_income, f.total_equity)


def return_on_assets(f: ExtractedFinancials) -> Optional[float]:
    """Return on assets = net_income / total_assets."""
    return _safe_div(f.net_income, f.total_assets)


# ---------------------------------------------------------------------------
# Growth rates (requires two periods)
# ---------------------------------------------------------------------------


def yoy_growth(current: Optional[float], prior: Optional[float]) -> Optional[float]:
    """Year-over-year growth rate = (current - prior) / |prior|.

    Returns None if either value is missing or prior is zero.
    """
    if current is None or prior is None or prior == 0:
        return None
    return (current - prior) / abs(prior)


def revenue_growth(current: ExtractedFinancials, prior: ExtractedFinancials) -> Optional[float]:
    """YoY revenue growth between two reporting periods."""
    return yoy_growth(current.revenue, prior.revenue)


def net_income_growth(
    current: ExtractedFinancials, prior: ExtractedFinancials
) -> Optional[float]:
    """YoY net income growth between two reporting periods."""
    return yoy_growth(current.net_income, prior.net_income)


def eps_growth(current: ExtractedFinancials, prior: ExtractedFinancials) -> Optional[float]:
    """YoY diluted EPS growth between two reporting periods."""
    return yoy_growth(current.eps_diluted, prior.eps_diluted)


# ---------------------------------------------------------------------------
# Summary roll-up
# ---------------------------------------------------------------------------


def compute_all_ratios(f: ExtractedFinancials) -> dict:
    """Compute every single-period ratio and return a flat dict.

    Keys with a ``None`` value indicate insufficient data for that metric.
    """
    return {
        "gross_margin": gross_margin(f),
        "operating_margin": operating_margin(f),
        "net_margin": net_margin(f),
        "ebitda_margin": ebitda_margin(f),
        "debt_to_equity": debt_to_equity(f),
        "debt_to_assets": debt_to_assets(f),
        "interest_coverage": interest_coverage(f),
        "return_on_equity": return_on_equity(f),
        "return_on_assets": return_on_assets(f),
    }


def compute_growth_rates(
    current: ExtractedFinancials, prior: ExtractedFinancials
) -> dict:
    """Compute YoY growth rates between two periods."""
    return {
        "revenue_growth": revenue_growth(current, prior),
        "net_income_growth": net_income_growth(current, prior),
        "eps_growth": eps_growth(current, prior),
    }