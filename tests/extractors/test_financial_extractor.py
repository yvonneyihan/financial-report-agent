"""Unit tests for src/extractors/financial_extractor.py.

Anthropic API calls are mocked — these tests run without a real API key.
Integration tests (real API) are gated by RUN_INTEGRATION_TESTS=1.
"""

from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, patch

import pytest

from src.extractors.financial_extractor import ExtractionError, extract_financials
from src.extractors.models import ExtractedFinancials


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_claude_response(data: dict) -> MagicMock:
    """Build a fake Anthropic message response containing JSON."""
    content_block = MagicMock()
    content_block.text = json.dumps(data)

    message = MagicMock()
    message.content = [content_block]
    return message


_VALID_PAYLOAD = {
    "company_name": "Acme Corp",
    "report_period": "FY 2023",
    "report_date": "2023-12-31",
    "revenue": 1000.0,
    "cost_of_goods_sold": 600.0,
    "gross_profit": 400.0,
    "operating_expenses": 150.0,
    "operating_income": 250.0,
    "ebitda": 300.0,
    "interest_expense": 20.0,
    "net_income": 180.0,
    "eps_basic": 3.60,
    "eps_diluted": 3.50,
    "shares_outstanding": 50.0,
    "total_assets": 2000.0,
    "total_liabilities": 800.0,
    "total_equity": 1200.0,
    "long_term_debt": 600.0,
    "cash_and_equivalents": 250.0,
    "free_cash_flow": 220.0,
}


# ---------------------------------------------------------------------------
# Happy-path tests
# ---------------------------------------------------------------------------


@patch("src.extractors.financial_extractor.anthropic.Anthropic")
def test_extract_financials_returns_model(mock_anthropic_cls):
    mock_client = MagicMock()
    mock_anthropic_cls.return_value = mock_client
    mock_client.messages.create.return_value = _make_claude_response(_VALID_PAYLOAD)

    with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}):
        result = extract_financials("Some financial report text")

    assert isinstance(result, ExtractedFinancials)
    assert result.company_name == "Acme Corp"
    assert result.revenue == 1000.0
    assert result.eps_diluted == 3.50


@patch("src.extractors.financial_extractor.anthropic.Anthropic")
def test_extract_financials_allows_null_fields(mock_anthropic_cls):
    payload = dict(_VALID_PAYLOAD)
    payload["ebitda"] = None
    payload["free_cash_flow"] = None

    mock_client = MagicMock()
    mock_anthropic_cls.return_value = mock_client
    mock_client.messages.create.return_value = _make_claude_response(payload)

    with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}):
        result = extract_financials("Some text")

    assert result.ebitda is None
    assert result.free_cash_flow is None


@patch("src.extractors.financial_extractor.anthropic.Anthropic")
def test_extract_financials_uses_model_env_var(mock_anthropic_cls):
    mock_client = MagicMock()
    mock_anthropic_cls.return_value = mock_client
    mock_client.messages.create.return_value = _make_claude_response(_VALID_PAYLOAD)

    env = {"ANTHROPIC_API_KEY": "test-key", "MODEL": "claude-haiku-4-5-20251001"}
    with patch.dict(os.environ, env):
        extract_financials("text")

    call_kwargs = mock_client.messages.create.call_args.kwargs
    assert call_kwargs["model"] == "claude-haiku-4-5-20251001"


# ---------------------------------------------------------------------------
# Error handling tests
# ---------------------------------------------------------------------------


@patch("src.extractors.financial_extractor.anthropic.Anthropic")
def test_extract_financials_raises_on_non_json(mock_anthropic_cls):
    content_block = MagicMock()
    content_block.text = "Sorry, I cannot help with that."
    message = MagicMock()
    message.content = [content_block]

    mock_client = MagicMock()
    mock_anthropic_cls.return_value = mock_client
    mock_client.messages.create.return_value = message

    with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}):
        with pytest.raises(ExtractionError, match="non-JSON"):
            extract_financials("text")


@patch("src.extractors.financial_extractor.anthropic.Anthropic")
def test_extract_financials_raises_on_missing_required_field(mock_anthropic_cls):
    payload = dict(_VALID_PAYLOAD)
    del payload["company_name"]  # required field

    mock_client = MagicMock()
    mock_anthropic_cls.return_value = mock_client
    mock_client.messages.create.return_value = _make_claude_response(payload)

    with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}):
        with pytest.raises(ExtractionError, match="schema validation"):
            extract_financials("text")


# ---------------------------------------------------------------------------
# Integration test (gated)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    not os.environ.get("RUN_INTEGRATION_TESTS"),
    reason="Set RUN_INTEGRATION_TESTS=1 to run against the real Anthropic API",
)
def test_extract_financials_integration():
    sample_text = """
    Acme Corporation — Annual Report FY 2023
    Revenue: $1,000 million
    Gross Profit: $400 million
    Operating Income: $200 million
    Net Income: $150 million
    Diluted EPS: $3.00
    Total Assets: $2,000 million
    Total Liabilities: $800 million
    Cash and Equivalents: $250 million
    """
    result = extract_financials(sample_text)
    assert result.company_name is not None
    assert result.revenue is not None
