# Financial Report Agent → AI Financial Research Copilot

This repo is being upgraded from a Python financial-report analysis pipeline
into a full-stack, TypeScript-first **AI Financial Research Copilot**: upload
financial reports, ask natural-language questions, and get answers grounded
in the documents with page-level citations — plus (in later phases) agentic
tool use and an MCP server.

**See [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) for the full
architecture, what's reused vs. rebuilt, and the phased roadmap.** This
README covers what exists today and how to run it.

## Status

| Layer | Status |
|---|---|
| Python financial pipeline (`src/parsers`, `extractors`, `calculators`, `analyzers`) | ✅ existing, reused as-is |
| Legacy public API (`src/api.py`) | ⚠️ still works, now **deprecated** — superseded by `server/` |
| Internal finance-core API (`src/internal_api.py`) | ✅ new — private, consumed only by `server/` |
| TypeScript backend (`server/`) — ingestion, pgvector retrieval, grounded QA | ✅ new (Phase 2) |
| LangGraph.js agent · MCP server · Vue 3 frontend · eval harness | ⬜ not yet built (Phases 4–6) |

## Architecture (current)

```
                 (Phase 6, not yet built)
                 ┌─────────────────────┐
                 │  web/  Vue 3 + TS   │
                 └──────────┬──────────┘
                            │ HTTPS /api/v1/*  (API key)
┌───────────────────────────▼────────────────────────────────────────┐
│ server/  Node + TypeScript — the only public API                   │
│  http/ (Fastify) → ingestion/ → retrieval/ (pgvector) → qa/ (RAG)   │
│                         │                        │                 │
│                    infra/db (pg+pgvector)   infra/llm (LangChain.js)│
│                         │                        │                 │
│                    infra/python (typed client, internal only)      │
└─────────────────────────┼───────────────────────────────────────────┘
                           │ private network, X-Internal-Token
┌──────────────────────────▼──────────────────────────────────────────┐
│ finance-core (existing Python, src/internal_api.py)                 │
│   POST /internal/v1/parse  →  pdfplumber, page-aware text + tables  │
│   (src/extractors, src/calculators exposed here in Phase 3)         │
└────────────────────────────────────────────────────────────────────┘
```

`server/` is the only public entry point. `finance-core` is never exposed to
the host in Docker Compose. The legacy `src/api.py` (FastAPI, with its own
PostgreSQL tables `reports`/`analysis_results`) still runs standalone for the
original single-document analyze-and-store workflow, but is not part of the
Copilot's public surface going forward.

## What It Does Today

**Python pipeline** (unchanged):
1. **Parses** PDF financial documents — `src/parsers` (now with a page-aware
   `parse_pdf_pages` alongside the original `parse_pdf`).
2. **Extracts** 20 financial figures via Claude — `src/extractors`.
3. **Calculates** margins, leverage ratios, and YoY growth — `src/calculators`
   (pure functions, no I/O).
4. **Analyzes** results via Claude — `src/analyzers` (trend narrative, risk
   flags).

**TypeScript Copilot** (new, Phase 2):
1. Upload a PDF → `server` calls `finance-core` to parse it page-by-page,
   chunks it (table-aware — see below), embeds each chunk, and stores it in
   Postgres/pgvector.
2. Ask a question → `server` retrieves the most relevant chunks (with
   company/ticker/fiscal-year filters) and asks Claude to answer **using only
   those passages**. Citations are verified server-side (quote must actually
   appear in the source chunk) — the model can never invent one.
3. If nothing relevant was retrieved, no LLM call is made and the API
   explicitly says the documents don't contain enough information — see
   `server/src/qa/`.

## Project Structure

```
financial_report_agent/
├── src/                       # Python pipeline (see CLAUDE.md for conventions)
│   ├── parsers/                pdf_parser.py (+ page-aware parse_pdf_pages), models.py
│   ├── extractors/              financial_extractor.py, models.py
│   ├── calculators/             ratios.py
│   ├── analyzers/                narrative.py, risk_flags.py
│   ├── api.py                   legacy public API (deprecated)
│   └── internal_api.py          NEW internal-only API for server/
├── tests/                     # pytest — mirrors src/, + tests/fixtures/
├── demo/                      # python demo/analyze_report.py --file ...
├── server/                    # NEW TypeScript backend (Fastify + LangChain.js + pgvector)
│   ├── migrations/              SQL migrations (documents, document_chunks)
│   ├── src/
│   │   ├── config/               Zod-validated env
│   │   ├── domain/                Zod schemas, typed errors
│   │   ├── infra/                  db (pg/pgvector), llm (LangChain.js), python (typed client)
│   │   ├── ingestion/               table-aware chunker, metadata heuristics, pipeline
│   │   ├── retrieval/                pgvector-backed LangChain BaseRetriever
│   │   ├── qa/                        grounded answer generation + citation verification
│   │   └── http/                       Fastify app, auth, routes
│   └── test/                    Vitest — unit/ (no deps) + integration/ (real Postgres + finance-core)
├── docker-compose.yml
├── Dockerfile.finance-core
├── server/Dockerfile
└── IMPLEMENTATION_PLAN.md
```

## Quickstart

### Option A — Docker Compose (recommended for the full Copilot)

```bash
cp .env.example .env              # fill in ANTHROPIC_API_KEY, INTERNAL_API_TOKEN
cp server/.env.example server/.env.docker  # for reference; compose sets these itself
docker compose up --build
# server:       http://localhost:3000  (the only published port)
# finance-core and db are internal-only — see docker-compose.yml comments to expose them for debugging
```

You'll also need `OPENAI_API_KEY` set (Anthropic has no embeddings API — see
`IMPLEMENTATION_PLAN.md` §2) unless you set `EMBEDDING_PROVIDER=fake` for a
no-external-cost smoke test (embeddings will not be semantically meaningful).

### Option B — Run each piece locally

```bash
# 1. Python env + internal API
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env               # set ANTHROPIC_API_KEY, INTERNAL_API_TOKEN
uvicorn src.internal_api:app --port 8001

# 2. Postgres + pgvector (a disposable local instance)
docker run -d --name fra-postgres -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=financial_agent \
  pgvector/pgvector:pg17

# 3. TypeScript server
cd server
npm install
cp .env.example .env               # must match INTERNAL_API_TOKEN from step 1
npm run migrate                    # applies migrations/*.sql
npm run dev                        # http://localhost:3000
```

### Try it

```bash
curl -X POST http://localhost:3000/api/v1/documents \
  -H "X-API-Key: dev-key-1" \
  -F "file=@tests/fixtures/acme_annual_report_fy2024.pdf" \
  -F "companyName=Acme Corporation"

curl -X POST http://localhost:3000/api/v1/ask \
  -H "X-API-Key: dev-key-1" -H "content-type: application/json" \
  -d '{"question": "What was Acme'\''s revenue and operating income in fiscal 2024?"}'
```

### Legacy standalone Python pipeline (still works)

```bash
python demo/analyze_report.py --file path/to/report.pdf
uvicorn src.api:app --reload    # deprecated public API — see IMPLEMENTATION_PLAN.md §4
```

## Environment Variables

**Repo root `.env`** (Python — `src/internal_api.py`, `src/api.py`, demo):

| Variable | Description | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API key | — |
| `MODEL` | Claude model ID | `claude-opus-4-6` |
| `MAX_TOKENS` | Max tokens per Claude response | `8192` |
| `LOG_LEVEL` | Logging verbosity | `INFO` |
| `INTERNAL_API_TOKEN` | Shared secret `server/` uses to call `src/internal_api.py` | — |
| `DATABASE_URL` | Only needed for the legacy `src/api.py` | — |

**`server/.env`** (TypeScript backend): see `server/.env.example` for the full,
commented list — database, the internal Python service URL/token, upload
limits, API keys (`key:ownerId` pairs — a placeholder auth scheme, see
`IMPLEMENTATION_PLAN.md` §2), embedding provider/model/dimensions, LLM
provider/model, and retrieval tuning (`RETRIEVAL_TOP_K`, `MIN_RELEVANCE`).

## Database Setup

Two schemas coexist in the same Postgres instance:

- **Legacy** (`src/database.py`): `reports`, `analysis_results` — created via
  SQLAlchemy `create_all()` when `src/api.py` starts.
- **New** (`server/migrations/*.sql`): `documents`, `document_chunks`
  (pgvector, HNSW index) — applied via `npm run migrate` or `AUTO_MIGRATE=true`.
  `pgvector` (>= 0.8.0 recommended, for accurate filtered search) must be
  installed on the Postgres instance — the `pgvector/pgvector:pg17` Docker
  image includes it.

## Testing

**Python:**
```bash
pytest                                # 36 passed, 1 skipped
RUN_INTEGRATION_TESTS=1 pytest        # + real-API integration test
```

**TypeScript:**
```bash
cd server
npm test                              # unit tests only — no external deps, 56 passed
RUN_INTEGRATION_TESTS=1 npm run test:integration
                                       # + real Postgres/pgvector + real finance-core (spawns
                                       # uvicorn itself) — set TEST_DATABASE_URL if not the default
                                       # postgres://postgres:postgres@localhost:55432/fra_test
```

Integration tests use a **fake** embeddings provider and a **fake** chat model
(deterministic, no network) — they exercise real Postgres/pgvector and the
real Python service, not real Anthropic/OpenAI calls. No performance or
answer-quality claims are made about real models until the Phase 6 eval
harness measures them (see `IMPLEMENTATION_PLAN.md` §9, risk R9).

## MCP Server Configuration

Not yet built — planned for Phase 5. See `IMPLEMENTATION_PLAN.md` §8/§9.

## AI Evaluation Results

Not yet run — the benchmark dataset and evaluation harness are planned for
Phase 6. No performance numbers are claimed before then.

## License

MIT
