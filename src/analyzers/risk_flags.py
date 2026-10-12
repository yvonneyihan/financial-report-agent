"""Risk flag analyzer — identifies financial warning signals using Claude.

Returns a structured list of flags so downstream consumers (the API, a report
renderer) can process them programmatically rather than parsing prose.
"""

from __future__ import annotations

import json
import os
from typing import Optional

import anthropic
from pydantic import BaseModel

from src.extractors.models import ExtractedFinancials

# ---------------------------------------------------------------------------
# Output model
# ---------------------------------------------------------------------------


class RiskFlag(BaseModel):
    """A single identified risk signal."""

    severity: str          # "high", "medium", or "low"
    category: str          # e.g. "leverage", "liquidity", "profitability"
    description: str       # one-sentence plain-English explanation
    metric: Optional[str]  # the specific ratio or figure that triggered it


class RiskFlagReport(BaseModel):
    flags: list[RiskFlag]
    overall_risk_level: str  # "high", "medium", or "low"
    summary: str             # ≤ 50-word overview


# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
You are a credit risk analyst reviewing a company's financial data.
Identify any financial warning signals in the data and return ONLY a JSON
object matching this exact schema — no markdown, no preamble:

{
  "flags": [
    {
      "severity":    "high" | "medium" | "low",
      "category":    string,
      "description": string,
      "metric":      string | null
    }
  ],
  "overall_risk_level": "high" | "medium" | "low",
  "summary": string
}

Risk categories to consider: leverage, liquidity, profitability, coverage,
cash_flow, earnings_quality.

If no risks are identified, return an empty flags array and overall_risk_level
of "low".
"""

_USER_TEMPLATE = """\
Identify risk flags in the following financial data:

{data_json}
"""

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


class RiskAnalysisError(RuntimeError):
    """Raised when risk flag analysis fails."""


def analyze_risk(
    financials: ExtractedFinancials,
    ratios: dict,
    *,
    model: str | None = None,
    max_tokens: int | None = None,
) -> RiskFlagReport:
    """Identify financial risk flags for one reporting period.

    Args:
        financials: Extracted financial figures.
        ratios: Computed ratios from :func:`~src.calculators.ratios.compute_all_ratios`.
        model: Claude model ID (defaults to ``MODEL`` env var or ``claude-opus-4-6``).
        max_tokens: Token limit (defaults to 1024).

    Returns:
        A :class:`RiskFlagReport` with structured flags and an overall assessment.

    Raises:
        RiskAnalysisError: If Claude returns invalid JSON or schema validation fails.
    """
    resolved_model = model or os.environ.get("MODEL", "claude-opus-4-6")
    resolved_max_tokens = max_tokens or int(os.environ.get("MAX_TOKENS", "1024"))

    payload = {
        "financials": financials.model_dump(),
        "ratios": ratios,
    }

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    message = client.messages.create(
        model=resolved_model,
        max_tokens=resolved_max_tokens,
        system=_SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": _USER_TEMPLATE.format(data_json=json.dumps(payload, indent=2)),
            }
        ],
    )

    raw = message.content[0].text.strip()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RiskAnalysisError(f"Claude returned non-JSON: {raw[:200]}") from exc

    try:
        return RiskFlagReport.model_validate(data)
    except Exception as exc:
        raise RiskAnalysisError(f"Risk report schema validation failed: {exc}") from exc
