import type { ChunkMetadata, ChunkType, DocumentType, RetrievalFilters, RetrievedChunk } from "../../domain/schemas.js";
import type { Pool } from "./pool.js";
import { toVectorLiteral } from "./pool.js";

interface SearchRow {
  chunk_id: string;
  document_id: string;
  file_name: string;
  company_name: string | null;
  ticker: string | null;
  fiscal_year: number | null;
  reporting_period: string | null;
  document_type: DocumentType | null;
  page_number: number;
  chunk_type: ChunkType;
  content: string;
  metadata: ChunkMetadata;
  distance: number;
}

export interface VectorSearchOptions {
  ownerId: string;
  queryEmbedding: number[];
  topK: number;
  filters?: RetrievalFilters;
  minRelevance?: number;
  /** Enables accurate results under metadata filtering on pgvector >= 0.8 (see migrate.ts assertEmbeddingSchema). */
  supportsIterativeScan: boolean;
}

/**
 * Cosine-similarity search over document_chunks, scoped to one owner and
 * optionally filtered by document/company/ticker/fiscal year.
 */
export async function vectorSearch(pool: Pool, opts: VectorSearchOptions): Promise<RetrievedChunk[]> {
  const conditions: string[] = ["d.owner_id = $1", "d.status = 'ready'"];
  const params: unknown[] = [opts.ownerId, toVectorLiteral(opts.queryEmbedding)];
  let paramIndex = 3;

  const filters = opts.filters;
  if (filters?.documentIds?.length) {
    conditions.push(`c.document_id = ANY($${paramIndex}::uuid[])`);
    params.push(filters.documentIds);
    paramIndex++;
  }
  if (filters?.company) {
    conditions.push(`d.company_name ILIKE $${paramIndex}`);
    params.push(`%${filters.company}%`);
    paramIndex++;
  }
  if (filters?.ticker) {
    conditions.push(`d.ticker = $${paramIndex}`);
    params.push(filters.ticker);
    paramIndex++;
  }
  if (filters?.fiscalYears?.length) {
    conditions.push(`d.fiscal_year = ANY($${paramIndex}::int[])`);
    params.push(filters.fiscalYears);
    paramIndex++;
  }

  const topKParam = paramIndex;
  params.push(opts.topK);

  const client = await pool.connect();
  try {
    // See plan risk R5: without this, HNSW post-filters after limiting to topK,
    // which can return too few (or zero) rows when a filter excludes most chunks.
    if (opts.supportsIterativeScan) {
      await client.query("SET LOCAL hnsw.iterative_scan = relaxed_order");
    }
    const result = await client.query<SearchRow>(
      `SELECT c.id AS chunk_id, c.document_id, d.file_name, d.company_name, d.ticker,
              d.fiscal_year, d.reporting_period, d.document_type,
              c.page_number, c.chunk_type, c.content, c.metadata,
              c.embedding <=> $2::vector AS distance
         FROM document_chunks c
         JOIN documents d ON d.id = c.document_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY c.embedding <=> $2::vector
        LIMIT $${topKParam}`,
      params,
    );

    return result.rows
      .map((row): RetrievedChunk => ({
        chunkId: row.chunk_id,
        documentId: row.document_id,
        fileName: row.file_name,
        companyName: row.company_name,
        ticker: row.ticker,
        fiscalYear: row.fiscal_year,
        reportingPeriod: row.reporting_period,
        documentType: row.document_type,
        pageNumber: row.page_number,
        chunkType: row.chunk_type,
        content: row.content,
        metadata: row.metadata ?? {},
        // pgvector cosine distance is in [0, 2]; similarity = 1 - distance ∈ [-1, 1].
        score: 1 - row.distance,
      }))
      .filter((r) => opts.minRelevance === undefined || r.score >= opts.minRelevance);
  } finally {
    client.release();
  }
}
