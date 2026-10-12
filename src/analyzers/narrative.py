"""Trend narrative analyzer — generates a human-readable financial summary.

Each analyzer wraps a single analytical concern (per CLAUDE.md).  This module
handles trend narration only; risk flags live in risk_flags.py.
"""

from __future__ import annotations

import json
import os

import anthropic

from src.extractors.models import ExtractedFinancials

# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
You are a senior equity research analyst writing a concise earnings summary for
institutional investors.  You will receive structured financial data as JSON and
must produce a clear, factual narrative of no more than 150 words.

Guidelines:
- Lead with the most significant revenue and profitability trend.
- Mention margin direction (expanding, contracting, flat) with supporting figures.
- Note any notable balance sheet or cash flow developments.
- Use precise numbers from the data; do not round or generalise.
- Write in third person (refer to the company by name).
- Do not speculate about future performance.
- Return plain prose — no bullet points, no headers.
"""

_USER_TEMPLATE = """\
Generate a trend narrative for the following financial data:

{data_json}
"""

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


class NarrativeError(RuntimeError):
    """Raised when narrative generation fails."""


def generate_narrative(
    financials: ExtractedFinancials,
    ratios: dict,
    *,
    model: str | None = None,
    max_tokens: int | None = None,
) -> str:
    """Generate a trend narrative for one reporting period.

    Args:
        financials: Extracted financial figures for the period.
        ratios: Computed ratios from :func:`~src.calculators.ratios.compute_all_ratios`.
        model: Claude model ID (defaults to ``MODEL`` env var or ``claude-opus-4-6``).
        max_tokens: Token limit (defaults to ``MAX_TOKENS`` env var or 512).

    Returns:
        A plain-text narrative string (≤ 150 words).

    Raises:
        NarrativeError: If the API call fails or returns an empty response.
    """
    resolved_model = model or os.environ.get("MODEL", "claude-opus-4-6")
    resolved_max_tokens = max_tokens or int(os.environ.get("MAX_TOKENS", "512"))

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

    text = message.content[0].text.strip()
    if not text:
        raise NarrativeError("Claude returned an empty narrative.")
    return text
