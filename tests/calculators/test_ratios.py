"""Unit tests for src/calculators/ratios.py.

All tests use hard-coded ExtractedFinancials instances — no I/O, no mocks.
"""

import pytest

from src.calculators.ratios import (
    compute_all_ratios,
    compute_growth_rates,
    debt_to_equity,
    gross_margin,
    interest_coverage,
    net_margin,
    operating_margin,
    return_on_equity,
    yoy_growth,
)
from src.extractors.models import ExtractedFinancials


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_financials(**overrides) -> ExtractedFinancials:
    """Return a minimal ExtractedFinancials with sensible defaults."""
    defaults = dict(
        company_name="Acme Corp",
        report_period="FY 2023",
        revenue=1000.0,
        gross_profit=400.0,
        operating_income=200.0,
        net_income=150.0,
        ebitda=250.0,
        interest_expense=20.0,
        total_assets=2000.0,
        total_liabilities=800.0,
        total_equity=1200.0,
        long_term_debt=600.0,
        eps_diluted=3.0,
    )
    defaults.update(overrides)
    return ExtractedFinancials(**defaults)


@pytest.fixture
def base_financials() -> ExtractedFinancials:
    return _make_financials()


# ---------------------------------------------------------------------------
# Margin tests
# ---------------------------------------------------------------------------


def test_gross_margin(base_financials):
    assert gross_margin(base_financials) == pytest.approx(0.40)


def test_operating_margin(base_financials):
    assert operating_margin(base_financials) == pytest.approx(0.20)


def test_net_margin(base_financials):
    assert net_margin(base_financials) == pytest.approx(0.15)


def test_margin_none_when_revenue_missing():
    f = _make_financials(revenue=None)
    assert gross_margin(f) is None
    assert operating_margin(f) is None
    assert net_margin(f) is None


# ---------------------------------------------------------------------------
# Leverage tests
# ---------------------------------------------------------------------------


def test_debt_to_equity(base_financials):
    # 600 / 1200 = 0.5
    assert debt_to_equity(base_financials) == pytest.approx(0.50)


def test_interest_coverage(base_financials):
    # 200 / 20 = 10
    assert interest_coverage(base_financials) == pytest.approx(10.0)


def test_interest_coverage_none_when_no_interest():
    f = _make_financials(interest_expense=None)
    assert interest_coverage(f) is None


def test_interest_coverage_none_when_interest_zero():
    f = _make_financials(interest_expense=0.0)
    assert interest_coverage(f) is None


# ---------------------------------------------------------------------------
# YoY growth tests
# ---------------------------------------------------------------------------


def test_yoy_growth_positive():
    assert yoy_growth(110.0, 100.0) == pytest.approx(0.10)


def test_yoy_growth_negative():
    assert yoy_growth(90.0, 100.0) == pytest.approx(-0.10)


def test_yoy_growth_none_when_prior_zero():
    assert yoy_growth(100.0, 0.0) is None


def test_yoy_growth_none_when_missing():
    assert yoy_growth(None, 100.0) is None
    assert yoy_growth(100.0, None) is None


def test_revenue_growth_between_periods():
    prior = _make_financials(revenue=800.0)
    current = _make_financials(revenue=1000.0)
    rates = compute_growth_rates(current, prior)
    assert rates["revenue_growth"] == pytest.approx(0.25)


# ---------------------------------------------------------------------------
# compute_all_ratios
# ---------------------------------------------------------------------------


def test_compute_all_ratios_returns_expected_keys(base_financials):
    result = compute_all_ratios(base_financials)
    expected_keys = {
        "gross_margin",
        "operating_margin",
        "net_margin",
        "ebitda_margin",
        "debt_to_equity",
        "debt_to_assets",
        "interest_coverage",
        "return_on_equity",
        "return_on_assets",
    }
    assert expected_keys == set(result.keys())


def test_compute_all_ratios_no_none_on_complete_data(base_financials):
    result = compute_all_ratios(base_financials)
    # All fields provided — only debt_to_assets might differ but should not be None
    assert all(v is not None for v in result.values())
