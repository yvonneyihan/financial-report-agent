# Financial Report Agent — Project Conventions

## Architecture

The project follows a layered pipeline:

```
Raw Input (PDF / HTML / Excel)
    → src/parsers/       # Extract raw text/data from file formats
    → src/extractors/    # Identify and pull structured financial data
    → src/calculators/   # Compute derived metrics and ratios
    → src/analyzers/     # Claude-powered reasoning and narrative generation
    → API (FastAPI)      # Serve results over HTTP
```

Each layer should be independently testable and have no knowledge of layers above it.

## Module Responsibilities

- **parsers/**: Format-specific ingestion only. No financial logic. Returns raw strings or DataFrames.
- **extractors/**: Pattern matching and entity extraction (revenue, EPS, dates). Returns Pydantic models.
- **calculators/**: Pure functions. No I/O, no API calls. Input/output are Pydantic models or primitives.
- **analyzers/**: Calls the Anthropic API. Each analyzer wraps a single analytical concern (e.g., sentiment, risk flags, trend analysis).

## Code Conventions

- Python 3.11+
- Type-annotate all function signatures.
- Use Pydantic v2 models for all data structures crossing module boundaries.
- Prefer `pathlib.Path` over `str` for file paths.
- Use `python-dotenv` to load `.env`; never hard-code credentials.
- Raise specific exceptions (not bare `Exception`) and let callers handle them.
- No global mutable state.

## Anthropic SDK Usage

- Always load the API key from the environment: `os.environ["ANTHROPIC_API_KEY"]`.
- Use `claude-opus-4-6` as the default model unless a faster model is sufficient.
- Structure prompts with a clear system role and a user message. Pass financial data as structured JSON inside the user turn, not in the system prompt.
- Prefer `client.messages.create(...)` (synchronous) in CLI/demo contexts and `AsyncAnthropic` in the FastAPI server.

## Testing

- Place tests in `tests/` mirroring the `src/` structure (e.g., `tests/parsers/test_pdf_parser.py`).
- Use `pytest` with fixtures for sample financial documents stored under `tests/fixtures/`.
- Mock Anthropic API calls in unit tests using `unittest.mock.patch`.
- Integration tests (hitting real APIs) must be gated by an env var `RUN_INTEGRATION_TESTS=1`.

## Demo Scripts

- Scripts in `demo/` are standalone entry points showing end-to-end usage.
- Each script should be runnable with `python demo/<script>.py` and have a `__main__` guard.
- Keep demo scripts short — delegate logic to `src/`.

## Environment

- Copy `.env.example` to `.env` and fill in your values before running anything.
- Never commit `.env` to version control.
