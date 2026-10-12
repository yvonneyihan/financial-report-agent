-- Document ingestion + vector retrieval schema.
-- `${EMBEDDING_DIMENSIONS}` is substituted by the migration runner (src/infra/db/migrate.ts).
-- Legacy tables (reports, analysis_results) created by the Python app are untouched.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         text        NOT NULL,
  file_name        text        NOT NULL,
  content_sha256   char(64)    NOT NULL,
  size_bytes       bigint      NOT NULL CHECK (size_bytes >= 0),
  storage_path     text        NOT NULL,
  status           text        NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'processing', 'ready', 'failed')),
  error_message    text,
  company_name     text,
  ticker           text,
  fiscal_year      integer,
  reporting_period text,
  document_type    text        CHECK (document_type IS NULL OR document_type IN ('10-K', '10-Q', 'annual-report', 'earnings-release', 'other')),
  page_count       integer,
  metadata_sources jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- per field: 'user' | 'heuristic'
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documents_owner_hash_unique UNIQUE (owner_id, content_sha256)
);

CREATE INDEX documents_owner_company_year_idx ON documents (owner_id, lower(company_name), fiscal_year);
CREATE INDEX documents_owner_status_idx ON documents (owner_id, status);

CREATE TABLE document_chunks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     uuid        NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  chunk_index     integer     NOT NULL,
  page_number     integer     NOT NULL CHECK (page_number >= 1),
  chunk_type      text        NOT NULL CHECK (chunk_type IN ('text', 'table')),
  content         text        NOT NULL,
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,     -- section, units, currency, periods
  embedding       vector(${EMBEDDING_DIMENSIONS}) NOT NULL,
  embedding_model text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_chunks_doc_index_unique UNIQUE (document_id, chunk_index)
);

CREATE INDEX document_chunks_document_idx ON document_chunks (document_id);
CREATE INDEX document_chunks_embedding_hnsw ON document_chunks USING hnsw (embedding vector_cosine_ops);
