import { BaseRetriever, type BaseRetrieverInput } from "@langchain/core/retrievers";
import { Document } from "@langchain/core/documents";
import type { CallbackManagerForRetrieverRun } from "@langchain/core/callbacks/manager";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { Pool } from "../infra/db/pool.js";
import { vectorSearch } from "../infra/db/vectorSearch.js";
import type { RetrievalFilters, RetrievedChunk } from "../domain/schemas.js";

/** LangChain document metadata carrying everything needed to build a citation later. */
export interface RetrievedChunkMetadata extends Record<string, unknown> {
  chunkId: string;
  documentId: string;
  fileName: string;
  companyName: string | null;
  ticker: string | null;
  fiscalYear: number | null;
  reportingPeriod: string | null;
  pageNumber: number;
  chunkType: string;
  score: number;
}

export interface PgVectorRetrieverInput extends BaseRetrieverInput {
  pool: Pool;
  embeddings: EmbeddingsInterface;
  ownerId: string;
  topK: number;
  filters?: RetrievalFilters;
  minRelevance?: number;
  supportsIterativeScan: boolean;
}

/**
 * pgvector-backed retriever, implemented against LangChain's `BaseRetriever`
 * so it can be swapped for another retrieval strategy without touching QA or
 * agent code (see IMPLEMENTATION_PLAN.md §2, "Vector store" row).
 */
export class PgVectorRetriever extends BaseRetriever {
  lc_namespace = ["fra", "retrieval", "pgvector"];

  private readonly pool: Pool;
  private readonly embeddings: EmbeddingsInterface;
  private readonly ownerId: string;
  private readonly topK: number;
  private readonly filters?: RetrievalFilters;
  private readonly minRelevance?: number;
  private readonly supportsIterativeScan: boolean;

  constructor(fields: PgVectorRetrieverInput) {
    super(fields);
    this.pool = fields.pool;
    this.embeddings = fields.embeddings;
    this.ownerId = fields.ownerId;
    this.topK = fields.topK;
    this.filters = fields.filters;
    this.minRelevance = fields.minRelevance;
    this.supportsIterativeScan = fields.supportsIterativeScan;
  }

  override async _getRelevantDocuments(
    query: string,
    _runManager?: CallbackManagerForRetrieverRun,
  ): Promise<Document<RetrievedChunkMetadata>[]> {
    const chunks = await this.searchChunks(query);
    return chunks.map(chunkToDocument);
  }

  /** Same search, returning the richer domain type (score, doc type, ...) the QA layer needs beyond LangChain's Document shape. */
  async searchChunks(query: string): Promise<RetrievedChunk[]> {
    const queryEmbedding = await this.embeddings.embedQuery(query);
    return vectorSearch(this.pool, {
      ownerId: this.ownerId,
      queryEmbedding,
      topK: this.topK,
      supportsIterativeScan: this.supportsIterativeScan,
      ...(this.filters ? { filters: this.filters } : {}),
      ...(this.minRelevance !== undefined ? { minRelevance: this.minRelevance } : {}),
    });
  }
}

export function chunkToDocument(chunk: RetrievedChunk): Document<RetrievedChunkMetadata> {
  return new Document({
    pageContent: chunk.content,
    metadata: {
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      fileName: chunk.fileName,
      companyName: chunk.companyName,
      ticker: chunk.ticker,
      fiscalYear: chunk.fiscalYear,
      reportingPeriod: chunk.reportingPeriod,
      pageNumber: chunk.pageNumber,
      chunkType: chunk.chunkType,
      score: chunk.score,
    },
  });
}
