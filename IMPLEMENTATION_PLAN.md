# Implementation Plan — TypeScript-First AI Financial Research Copilot

_Last updated: 2026-09-23 · Status: **Phases 1–2 complete** (see [§8](#8-implementation-milestones))_

---

## 0. Assessment summary (read this first)

The repository is **smaller than the project brief describes**. The plan is built on what is actually in the repo, not on the brief.

| Brief says | Repository actually contains |
|---|---|
| Vue.js frontend | **No frontend of any kind.** No `.vue`, `package.json`, or JS/TS files. |
| Django **and** FastAPI backend | **FastAPI only** (`src/api.py`). No Django. |
| PostgreSQL schema | Two SQLAlchemy tables (`reports`, `analysis_results`) created by `create_all()` at startup. No migrations. |
| >15 figures extracted via LLM | ✅ 20 fields (`src/extractors/models.py`) extracted in one Claude call. |
| Deterministic Python calculations | ✅ 9 single-period ratios + 3 growth rates (`src/calculators/ratios.py`), pure functions, tested. |
| Auth / deployment config | **None.** No auth on any route, no Dockerfile, no compose file. |
| — | The project is **not a git repository**. |
| — | `src/api.py` **cannot be imported in the current `.venv`**: `sqlalchemy`/`psycopg2` are in `requirements.txt` but not installed, and `python-multipart` (required by `UploadFile`) is not listed at all. The FastAPI app has never run in this environment. |
| — | Python baseline: `pytest` → 20 passed, 1 skipped (integration test, gated). |

**Consequences for the plan**

1. There is nothing to "preserve and migrate incrementally" on the frontend. Phase 6 builds a new **Vue 3 + TypeScript** app. _If your Vue app lives in another repo, point me at it and Phase 6 changes to "integrate", not "build"._
2. There is no Django API to migrate. The migration story is **FastAPI (public) → FastAPI (internal-only) + Fastify (public)**.
3. Reliable, tested Python logic (PDF parsing, extraction prompt, ratio math) is worth keeping, so it is reused behind an internal HTTP API rather than ported.

---

## 1. Current architecture

```
PDF ─► src/parsers/pdf_parser.py      pdfplumber → {"text": str, "tables": [DataFrame]}
        │                              (page numbers are discarded; pages joined with "\n\n")
        ▼
      src/extractors/                  ONE Claude call over the ENTIRE document text
        financial_extractor.py         → ExtractedFinancials (20 fields, Pydantic v2)
        │                              (single period, USD millions, no source/page provenance)
        ▼
      src/calculators/ratios.py        pure functions → dict of ratios / growth rates
        ▼
      src/analyzers/                   narrative.py, risk_flags.py — Claude, JSON in / JSON out
        ▼
      src/api.py (FastAPI)             POST /reports/analyze · GET /reports/{id} · GET /reports
        ▼
      src/database.py (SQLAlchemy)     reports(raw_text…), analysis_results(JSON columns…)
```

**Observations that matter for the upgrade**

| # | Observation | Impact |
|---|---|---|
| a | The extractor sends the **whole document** to the LLM and returns numbers with **no page/source reference**. | Cannot support citations; will not scale to 200-page 10-Ks. Retrieval-first design (RAG) is required. |
| b | Extraction is **single-period**; comparing years means running it per document. | Multi-year questions need retrieval + per-period metric records, not one blob. |
| c | Schema has `free_cash_flow` but **no operating cash flow**, which the brief lists. | Phase 3 adds the field (additive change). |
| d | `debt_to_equity` is defined as `long_term_debt / total_equity`. The common textbook variant is `total_liabilities / total_equity`. | Both are legitimate; the tool must **state the formula** and let the caller pick. Not silently changed. |
| e | Values are assumed **USD millions**; there is no currency/unit field on the model. | Phase 3 tool layer carries `unit`/`currency` explicitly and rejects mismatches. |
| f | `_safe_div` returns `None` on missing/zero, without saying *why*. | Phase 3 wraps calculators with a validation layer returning a reason (`missing_input`, `zero_denominator`, `period_mismatch`). |
| g | `parse_pdf` uses pdfplumber default (ruled-line) table detection. Most SEC filings have **borderless** financial tables that this will not detect. | Chunker must not depend on detected tables alone (see §9, R1). |
| h | No auth, no tests for parsers/api/analyzers, no Dockerfile. | Addressed in Phases 2 and 6. |

---

## 2. Target TypeScript-first architecture

```
                 ┌────────────────────────────────────────────────────────┐
                 │  web/  Vue 3 + TS (Phase 6)                            │
                 └───────────────────────────┬────────────────────────────┘
                                             │ HTTPS  /api/v1/*  (API key → ownerId)
┌────────────────────────────────────────────▼───────────────────────────────────────────┐
│ server/  Node 20 + TypeScript — the ONLY public API                                     │
│                                                                                         │
│  http/ (Fastify)         ── thin: auth, Zod validation, error mapping, no logic         │
│     │                                                                                   │
│  qa/  (RAG answer)   agent/ (LangGraph.js, Ph.4)   mcp/ (MCP server + client, Ph.5)     │
│     │                     │                              │      ← all reuse the same     │
│  retrieval/          tools/ (typed, Zod)  ◄──────────────┘        services below        │
│     │                     │                                                             │
│  ingestion/          infra/python (typed client) ──────────────┐                        │
│     │                                                          │                        │
│  infra/db (pg + pgvector)   infra/llm (LangChain.js models+embeddings)                  │
└─────┬──────────────────────────────────────────────────────────┼────────────────────────┘
      │                                                          │ internal network only
┌─────▼───────────────────────────┐                ┌─────────────▼───────────────────────┐
│ PostgreSQL 17 + pgvector        │                │ finance-core (existing Python)      │
│  documents, document_chunks     │                │  POST /internal/v1/parse   (Ph.2)   │
│  (+ legacy reports/analysis_…)  │                │  POST /internal/v1/extract (Ph.3)   │
└─────────────────────────────────┘                │  POST /internal/v1/calculate(Ph.3)  │
                                                   └─────────────────────────────────────┘
```

**Dependency rule (enforced by convention + review, checked by a test in Phase 6):**
`domain ← infra ← {ingestion, retrieval, qa, tools} ← {agent, mcp} ← http`. Lower layers never import upper ones. MCP tools and LangGraph tools call the *same* service functions.

### Why some things stay in Python (architectural reasons)

| Component | Stays in Python because |
|---|---|
| PDF parsing (pdfplumber) | Best-in-class table/layout extraction; no TypeScript library of comparable quality. Reimplementing would *reduce* quality. |
| Ratio/growth calculators | Already correct, pure, and tested (20 tests). Rewriting risks regressions for no gain. Exposed over HTTP with a Zod-validated client. |
| Legacy structured extractor | Working prompt + Pydantic validation. Called via HTTP until a TS replacement demonstrably outperforms it on the eval set. |

### Why TypeScript owns everything else
Orchestration (LangGraph.js), retrieval, MCP, tool schemas, HTTP API, and eval all live in one typed codebase so Zod schemas can be shared end-to-end (API ⇄ tools ⇄ MCP ⇄ frontend).

### Key design decisions

| Decision | Choice | Reason |
|---|---|---|
| Public API | **Fastify only** | Brief forbids duplicated public APIs. FastAPI becomes internal, token-guarded, not published to the host in compose. |
| Vector store | **Own SQL schema on pgvector**, wrapped in a LangChain `BaseRetriever` | LangChain's `PGVectorStore` keeps metadata in JSONB; we need typed, indexed filters (company/year/doc), page numbers, owner scoping, and swappable strategies for evaluation. LangChain is still used for `Embeddings`, `Document`, text splitting, chat models, prompts, structured output, retriever interface. |
| Embeddings | Pluggable `Embeddings` (OpenAI / local / fake-for-tests) | **Anthropic has no embeddings API.** Generation uses Claude; embeddings must come from another provider or a local model. |
| Vector dimension | Fixed per deployment (`EMBEDDING_DIMENSIONS`, default 1536), verified at startup; model name stored per chunk | pgvector HNSW needs fixed dimensions. Mixed spaces are prevented at query time. |
| LLM | Claude via `@langchain/anthropic`, model from env (`LLM_MODEL`, default `claude-opus-4-6` per `CLAUDE.md`) | Matches existing project convention. Do not pass sampling params so the same code works across model generations. |
| Citations | **Server-built, never model-written** | Model may only reference retrieval labels `[S1]…`; server validates labels against what was retrieved and builds doc name/page from DB rows. Quotes are verified as substrings of the cited chunk. |
| Insufficient info | Explicit `sufficient: false` path; short-circuit (no LLM call) on empty retrieval | Required by brief; avoids fabricated answers. |
| Numbers | LLM never computes ratios | Numbers in an answer that don't appear in retrieved context are flagged as `ungroundedNumbers`. Phase 3/4 route calculations through deterministic tools. |
| Auth (Phase 2) | Static API keys → `ownerId`, all queries owner-scoped | Minimal but real tenancy boundary. Explicitly a placeholder for OIDC/JWT. |
| Migrations | Small SQL-file runner | DDL needs `EMBEDDING_DIMENSIONS` substitution; simpler than fighting an ORM/migration tool. |

---

## 3. Existing components that will be reused

| Component | How |
|---|---|
| `src/parsers/pdf_parser.py` | Unchanged. New **additive** `parse_pdf_pages()` returns per-page text + tables so page numbers survive. |
| `src/extractors/*` | Unchanged; exposed via `/internal/v1/extract` in Phase 3. |
| `src/calculators/ratios.py` | Unchanged; exposed via `/internal/v1/calculate` in Phase 3. |
| `src/analyzers/*` | Unchanged; remain callable from Python. Phase 3 decides whether narrative/risk become TS tools or stay internal. |
| PostgreSQL | Same database, new tables. Legacy tables untouched. |
| Test conventions (`CLAUDE.md`) | pytest + mocks + `RUN_INTEGRATION_TESTS=1` gate — mirrored in Vitest. |

## 4. Components that will be migrated

| From | To | When |
|---|---|---|
| Public `POST /reports/analyze`, `GET /reports*` (FastAPI) | Fastify `/api/v1/*` | Phases 2–3. FastAPI routes get marked **deprecated** in Phase 3 and removed once the web app no longer needs them. |
| "One giant LLM call over full text" extraction | Retrieval-driven extraction (retrieve statement chunks → extract with provenance) | Phase 3 (evaluated against legacy path before switching). |

## 5. New components

| Component | Phase |
|---|---|
| `server/` Fastify app, config, logging, auth | 2 |
| Migrations + `documents` / `document_chunks` (pgvector) | 2 |
| Typed Python client (Zod-validated, timeouts, retry on 5xx only) | 2 (parse) · 3 (extract/calculate) |
| Table-aware chunker + metadata extractor | 2 |
| Retrieval (`Retriever` interface, pgvector strategy) | 2 |
| Grounded QA with server-verified citations | 2 |
| Financial metric service + calculation tools + validation layer | 3 |
| LangGraph.js agent, execution summary | 4 |
| MCP server + client | 5 |
| Vue 3 + TS app (documents, chat, dashboard, activity) | 6 |
| Eval harness + benchmark dataset | 6 (retrieval-recall harness may land earlier) |
| Dockerfiles, compose, README | 2 (db + services) · 6 (final) |

## 6. Proposed directory structure

```
financial_report_agent/
├── src/                          # EXISTING Python (layering per CLAUDE.md unchanged)
│   ├── parsers/ extractors/ calculators/ analyzers/
│   ├── api.py                    # legacy public API → deprecated in Phase 3
│   └── internal_api.py           # NEW  internal-only API for the TS server
├── tests/                        # existing pytest tree (+ new internal API tests, fixtures/)
├── server/                       # NEW  TypeScript backend
│   ├── migrations/               #      *.sql (templated on EMBEDDING_DIMENSIONS)
│   ├── src/
│   │   ├── config/               #      Zod-validated env
│   │   ├── domain/               #      Zod schemas + types (no I/O)
│   │   ├── infra/{db,python,llm}/
│   │   ├── ingestion/            #      chunker, metadata, pipeline
│   │   ├── retrieval/            #      Retriever interface + pgvector strategy
│   │   ├── qa/                   #      prompt, grounded answer, citation verification
│   │   ├── http/                 #      Fastify app, routes, auth, error mapping
│   │   ├── agent/                #      (Phase 4) LangGraph.js
│   │   ├── mcp/                  #      (Phase 5) MCP server + client
│   │   └── main.ts
│   └── test/                     #      Vitest unit + gated integration
├── web/                          # (Phase 6) Vue 3 + TS
├── eval/                         # (Phase 6) dataset + scripts
├── docker-compose.yml            # db (pgvector), finance-core, api
├── Dockerfile.finance-core · server/Dockerfile
└── IMPLEMENTATION_PLAN.md
```

A single `server/` package (not a multi-package workspace) is deliberate: the MCP server is a separate *process/entrypoint* but shares services by relative import, avoiding build-graph overhead. It can be split later if a second consumer appears.

## 7. Database changes

New tables only; legacy `reports` / `analysis_results` untouched.

```sql
CREATE EXTENSION IF NOT EXISTS vector;

documents(
  id uuid PK, owner_id text NOT NULL,
  file_name text, content_sha256 char(64), size_bytes bigint, storage_path text,
  status text CHECK (status IN ('queued','processing','ready','failed')), error_message text,
  company_name text, ticker text, fiscal_year int, reporting_period text, document_type text,
  page_count int, metadata_sources jsonb,           -- per-field: 'user' | 'llm' | 'heuristic'
  created_at, updated_at,
  UNIQUE (owner_id, content_sha256)                 -- idempotent re-upload
)

document_chunks(
  id uuid PK, document_id uuid → documents ON DELETE CASCADE,
  chunk_index int, page_number int, chunk_type text CHECK (IN ('text','table')),
  content text, metadata jsonb,                     -- units, currency, periods, section
  embedding vector(${EMBEDDING_DIMENSIONS}), embedding_model text,
  UNIQUE (document_id, chunk_index)
)
-- HNSW (vector_cosine_ops) on embedding; btree on document_id; btree on documents(owner_id, lower(company_name), fiscal_year)
```

Planned later: `financial_metrics(document_id, metric, period, value, unit, currency, page_number, source_chunk_id)` (Phase 3), `agent_runs` / `tool_calls` audit tables (Phase 4).

## 8. Implementation milestones

| Phase | Scope | Status |
|---|---|---|
| **1** | Inspect repo, design architecture, this document | ✅ done |
| **2** | `server/` scaffold; internal Python parse API; ingestion (parse → chunk → embed → pgvector); filtered vector search; grounded QA with verified citations; Docker db; Vitest unit + integration tests | ✅ done — see [§10](#10-phase-2-report) |
| 3 | Typed Python client for extract/calculate; `financial_metrics`; validation layer (period/unit/currency/denominator); deterministic ratio tools | ⬜ |
| 4 | LangGraph.js single-agent workflow with typed state, tool limits, re-retrieval on weak results, user-facing execution summary | ⬜ |
| 5 | MCP server (`get_financial_metrics`, `calculate_financial_ratio`, `search_financial_filings`) + MCP client for the agent; connection docs | ⬜ |
| 6 | Vue 3 + TS frontend; eval harness (30–50 questions, Recall@K, citation/number accuracy, latency, cost); README/Docker finalization | ⬜ |

Each phase ends with: explanation, file list, test results, remaining issues, this document updated, verification steps.

## 10. Phase 2 report

**What was built:**

- **Python side** (additive, existing tests untouched):
  - `src/parsers/models.py`, `src/parsers/pdf_parser.py` — new `parse_pdf_pages()` returns per-page text + detected tables (page numbers preserved); original `parse_pdf()` unchanged.
  - `src/internal_api.py` — new internal-only FastAPI service (`POST /internal/v1/parse`, token-guarded, fails closed if `INTERNAL_API_TOKEN` unset).
  - `requirements.txt` — added `python-multipart` (plan risk R10: the app couldn't run without it).
  - `tests/fixtures/make_sample_report.py` + generated `acme_annual_report_fy2024.pdf` — synthetic 4-page 10-K (ruled income-statement table + **borderless** balance sheet, to exercise plan risk R1) used by both Python and TypeScript tests.
  - `tests/parsers/test_pdf_parser.py`, `tests/test_internal_api.py` — new tests (36 passed, 1 skipped total, up from 20).

- **TypeScript side** (`server/`, new):
  - `config/env.ts` — Zod-validated env, fails fast with readable errors.
  - `domain/` — Zod schemas + typed error hierarchy (`AppError` subclasses map to HTTP status).
  - `infra/db/` — connection pool, SQL migration runner (`migrations/001_documents_and_chunks.sql`, `${EMBEDDING_DIMENSIONS}` templated), embedding-dimension schema guard, document store, pgvector cosine search (owner/company/ticker/fiscal-year filters, `hnsw.iterative_scan` for accurate filtered results per risk R5).
  - `infra/llm/` — swappable embeddings (OpenAI / fake-for-tests) and chat model (Anthropic default `claude-opus-4-6` per `CLAUDE.md` / OpenAI) factories.
  - `infra/python/client.ts` — typed, Zod-validated, retrying (5xx/network only) client for `internal_api.py`.
  - `ingestion/` — table-aware chunker (detected tables + a token-based heuristic for **borderless** tables, addressing risk R1 — verified against the synthetic fixture) and heuristic document metadata extraction (user-supplied fields always win; derived fields tagged `"heuristic"`).
  - `retrieval/retriever.ts` — pgvector search wrapped as a LangChain `BaseRetriever`.
  - `qa/` — grounded answer generation: server-built citations verified against actual retrieved text (never trusts the model's claim), ungrounded-number detection, and a zero-retrieval short-circuit that never calls the LLM.
  - `http/` — Fastify app; API-key auth (placeholder, not OIDC) scoped via an encapsulated `/api/v1` sub-app; routes for documents (upload/list/get), search, ask, health.
  - `Dockerfile`, root `Dockerfile.finance-core`, `docker-compose.yml`, both `.env.example` files.

**Tests:** 56 unit tests (no external deps) + 28 integration tests (real Postgres 17 + pgvector via Docker, real `internal_api.py` spawned as a subprocess, fake embeddings/chat model — no paid API calls) = 84 passed, 0 failed. `npm test` runs unit only; `RUN_INTEGRATION_TESTS=1 npm run test:integration` runs both, mirroring the Python convention in `CLAUDE.md`.

**Verified against the real stack, not just tests:** built both Docker images, ran `docker compose up`, and exercised the live containers with `curl` — health check, document upload (parse → chunk → embed → store), `/search`, and auth rejection all worked end-to-end. Stopped and removed all smoke-test containers/images afterward.

**Bugs found and fixed during this phase:** `deriveDocumentMetadata`'s fiscal-year regex excluded commas from its lookahead and so never matched real filing text ("...ended December 31, 2024"); fixed and covered by a test. Fastify 5 removed `request.routerPath` (used in an early auth-plugin draft) — replaced with scoping the auth plugin to the `/api/v1` sub-app instead of path-sniffing.

**Known limitations (see §9):** table-stitching across a page break is not implemented (R1); scanned/image-only PDFs are rejected, not OCR'd (R2); ingestion runs in-process inside the upload request, not a durable queue (R6); real-model (Anthropic/OpenAI) answer quality is unmeasured — everything above was verified with fake embeddings/chat models plus real Postgres/pgvector/parsing (R9).

**To verify yourself:**
```bash
# Python
pytest                                          # 36 passed, 1 skipped

# TypeScript — unit (no external services needed)
cd server && npm test                           # 56 passed

# TypeScript — integration (spins up its own Postgres/pgvector expectation;
# point TEST_DATABASE_URL at one, e.g.:
#   docker run -d --name fra-postgres -p 55432:5432 -e POSTGRES_PASSWORD=postgres \
#     -e POSTGRES_DB=fra_test pgvector/pgvector:pg17
RUN_INTEGRATION_TESTS=1 npm run test:integration  # 84 passed (56 + 28)

# Full stack (see README.md Quickstart for details)
cp .env.example .env && cp server/.env.example server/.env   # fill in keys
docker compose up --build
curl -X POST http://localhost:3000/api/v1/documents -H "X-API-Key: <one from API_KEYS>" \
  -F "file=@tests/fixtures/acme_annual_report_fy2024.pdf"
```

**Next:** Phase 3 (typed Python client for extract/calculate, `financial_metrics` table, validation layer, deterministic ratio tools).

## 9. Technical risks and migration considerations

| ID | Risk | Mitigation |
|---|---|---|
| R1 | **Borderless financial tables**: pdfplumber default detection misses most 10-K tables. | Chunker treats runs of label + numeric-column lines as atomic table blocks (with preceding units/period header lines) *regardless* of pdfplumber detection; detected tables get dedicated chunks. Limitation: tables spanning pages are not stitched in Phase 2. |
| R2 | **Scanned PDFs** (no text layer). | Detected (zero extractable text) → `failed` with clear error. OCR is out of scope; documented. |
| R3 | **No embeddings from Anthropic.** | Pluggable provider; needs `OPENAI_API_KEY` (or local model). Documented in README. |
| R4 | **Vector dimension lock-in.** | Startup check compares schema vs configured embedder; changing model = re-embed (documented). Evaluate alternatives in separate DBs. |
| R5 | **Filtered ANN recall** (HNSW post-filtering returns too few rows). | `hnsw.iterative_scan = relaxed_order` per query (pgvector ≥ 0.8; image pinned accordingly). |
| R6 | **In-process ingestion jobs** are lost on crash. | Status field + startup sweep marks stale `processing` rows failed. Durable queue (pg-boss) is a Phase 6+ option. |
| R7 | **LLM hallucinated citations / numbers.** | Server-built citations, verified quotes, ungrounded-number flags — all covered by tests with a fake model that misbehaves on purpose. |
| R8 | **Relevance threshold is model-specific.** | Not hard-coded; configurable (`MIN_RELEVANCE`, unset by default) and to be calibrated in the eval phase. No performance claims until measured. |
| R9 | **No live LLM/embedding credentials in the dev environment used for this build.** | Integration tests use real Postgres/pgvector + real PDF parsing with fake LLM/embeddings. A real-provider smoke test is documented for the user to run; **quality of real-model answers is unmeasured until then.** |
| R10 | **Legacy FastAPI app is not runnable as-is** (missing deps). | Add `python-multipart` to `requirements.txt`; install declared deps. Legacy routes kept but deprecated. |
| R11 | Project is not under version control. | Recommend `git init` before merging this work (not done automatically). |
