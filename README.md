# Financial Report Analysis Agent

An AI-powered pipeline for parsing, extracting, and analyzing financial reports (10-K, 10-Q, earnings releases, and Excel models) using Claude.

## What It Does

1. **Parses** raw financial documents — PDF, HTML, and Excel — into structured data.
2. **Extracts** key financial figures: revenue, net income, EPS, margins, and more.
3. **Calculates** derived metrics: YoY growth, operating leverage, liquidity ratios.
4. **Analyzes** results using Claude: trend narratives, risk flags, and executive summaries.
5. **Serves** everything via a FastAPI REST API.

## Project Structure

```
financial_report_agent/
├── src/
│   ├── parsers/        # PDF, HTML, Excel ingestion
│   ├── extractors/     # Financial entity extraction (Pydantic models)
│   ├── calculators/    # Pure metric computation
│   └── analyzers/      # Claude-powered analysis modules
├── tests/              # pytest test suite
├── demo/               # Standalone end-to-end demo scripts
├── .env.example        # Environment variable template
├── CLAUDE.md           # Project conventions for AI-assisted development
├── requirements.txt
└── README.md
```

## Quickstart

### 1. Clone and set up the environment

```bash
git clone <repo-url>
cd financial_report_agent
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure credentials

```bash
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY
```

### 3. Run a demo

```bash
python demo/analyze_report.py --file path/to/report.pdf
```

### 4. Start the API server

```bash
uvicorn src.api:app --reload
```

### 5. Run tests

```bash
pytest
# To include integration tests (requires a real API key):
RUN_INTEGRATION_TESTS=1 pytest
```

## Key Dependencies

| Package | Purpose |
|---|---|
| `anthropic` | Claude API client for LLM-powered analysis |
| `pdfplumber` | Extract text and tables from PDF reports |
| `beautifulsoup4` | Parse HTML filings (SEC EDGAR, IR pages) |
| `pydantic` | Data validation and typed financial models |
| `pandas` + `openpyxl` | Excel model ingestion and data manipulation |
| `fastapi` + `uvicorn` | REST API server |
| `pytest` | Test suite |
| `python-dotenv` | Environment variable management |

## Pipeline Overview

```
PDF / HTML / Excel
      │
      ▼
  parsers/          →  raw text, DataFrames
      │
      ▼
  extractors/       →  FinancialStatement, EarningsData (Pydantic)
      │
      ▼
  calculators/      →  ratios, growth rates, margins
      │
      ▼
  analyzers/        →  Claude narrative, risk flags, summary
      │
      ▼
  FastAPI response  →  JSON
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key | — |
| `MODEL` | Claude model ID | `claude-opus-4-6` |
| `MAX_TOKENS` | Max tokens per Claude response | `8192` |
| `LOG_LEVEL` | Logging verbosity | `INFO` |

## License

MIT
