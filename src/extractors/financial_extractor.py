"""Financial figure extractor — uses Claude to pull structured data from raw text.

Design decisions:
- The LLM handles *reading comprehension* (locating figures in messy text).
- All arithmetic and ratio computation is left to src/calculators/ (pure Python).
- Prompt engineering enforces a strict JSON schema so Pydantic can validate the
  response without a second LLM call.
- Inconsistent real-world formats (values in thousands vs millions, parentheses
  for negatives, abbreviated column headers) are handled in the system prompt.
"""

from __future__ import annotations

import json
import os

import anthropic

from .models import ExtractedFinancials

# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
You are a financial data extraction specialist. Your sole task is to read a
financial report excerpt and return a single JSON object that conforms exactly
to the schema below.

RULES:
1. Return ONLY valid JSON — no markdown fences, no preamble, no explanation.
2. Use null (not "N/A", not "") for any figure you cannot find or are unsure of.
3. All monetary values must be converted to millions USD.
   - If the report states values "in thousands", divide by 1000.
   - If the report states values "in billions", multiply by 1000.
4. Negative values (losses, expenses shown in parentheses) must be negative floats.
5. For report_date use YYYY-MM-DD format; use null if not determinable.
6. Do not infer or calculate values — extract only what is explicitly stated.

JSON SCHEMA:
{
  "company_name":         string,
  "report_period":        string,
  "report_date":          string | null,
  "revenue":              number | null,
  "cost_of_goods_sold":   number | null,
  "gross_profit":         number | null,
  "operating_expenses":   number | null,
  "operating_income":     number | null,
  "ebitda":               number | null,
  "interest_expense":     number | null,
  "net_income":           number | null,
  "eps_basic":            number | null,
  "eps_diluted":          number | null,
  "shares_outstanding":   number | null,
  "total_assets":         number | null,
  "total_liabilities":    number | null,
  "total_equity":         number | null,
  "long_term_debt":       number | null,
  "cash_and_equivalents": number | null,
  "free_cash_flow":       number | null
}
"""

_USER_TEMPLATE = """\
Extract all available financial figures from the report text below.

REPORT TEXT:
{text}
"""

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


class ExtractionError(ValueError):
    """Raised when Claude returns a response that cannot be parsed or validated."""


def extract_financials(
    text: str,
    *,
    model: str | None = None,
    max_tokens: int | None = None,
) -> ExtractedFinancials:
    """Extract structured financial figures from raw report text.

    Args:
        text: Raw text produced by a parser (e.g. ``parse_pdf``).
        model: Claude model ID.  Defaults to the ``MODEL`` env var or
            ``claude-opus-4-6``.
        max_tokens: Override the ``MAX_TOKENS`` env var (default 2048).

    Returns:
        A validated :class:`ExtractedFinancials` instance.

    Raises:
        ExtractionError: If Claude's response is not valid JSON or does not
            match the expected schema.
        anthropic.APIError: On network or authentication failures.
    """
    resolved_model = model or os.environ.get("MODEL", "claude-opus-4-6")
    resolved_max_tokens = max_tokens or int(os.environ.get("MAX_TOKENS", "2048"))

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    message = client.messages.create(
        model=resolved_model,
        max_tokens=resolved_max_tokens,
        system=_SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": _USER_TEMPLATE.format(text=text),
            }
        ],
    )

    raw_content = message.content[0].text.strip()

    try:
        data = json.loads(raw_content)
    except json.JSONDecodeError as exc:
        raise ExtractionError(
            f"Claude returned non-JSON output: {raw_content[:200]}"
        ) from exc

    try:
        return ExtractedFinancials.model_validate(data)
    except Exception as exc:
        raise ExtractionError(f"Extracted data failed schema validation: {exc}") from exc
