import type { PoolClient } from "pg";
import { NotFoundError } from "../../domain/errors.js";
import type {
  ChunkMetadata,
  ChunkType,
  DocumentRecord,
  DocumentStatus,
  DocumentType,
  MetadataSource,
} from "../../domain/schemas.js";
import type { Pool } from "./pool.js";
import { toVectorLiteral } from "./pool.js";

interface DocumentRow {
  id: string;
  owner_id: string;
  file_name: string;
  content_sha256: string;
  size_bytes: string; // bigint arrives as string
  storage_path: string;
  status: DocumentStatus;
  error_message: string | null;
  company_name: string | null;
  ticker: string | null;
  fiscal_year: number | null;
  reporting_period: string | null;
  document_type: DocumentType | null;
  page_count: number | null;
  metadata_sources: Record<string, MetadataSource>;
  chunk_count: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    fileName: row.file_name,
    contentSha256: row.content_sha256,
    sizeBytes: Number(row.size_bytes),
    storagePath: row.storage_path,
    status: row.status,
    errorMessage: row.error_message,
    companyName: row.company_name,
    ticker: row.ticker,
    fiscalYear: row.fiscal_year,
    reportingPeriod: row.reporting_period,
    documentType: row.document_type,
    pageCount: row.page_count,
    metadataSources: row.metadata_sources ?? {},
    chunkCount: Number(row.chunk_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_WITH_CHUNK_COUNT = `
  SELECT d.*, COUNT(c.id) AS chunk_count
    FROM documents d
    LEFT JOIN document_chunks c ON c.document_id = d.id
`;

export interface CreateDocumentInput {
  ownerId: string;
  fileName: string;
  contentSha256: string;
  sizeBytes: number;
  storagePath: string;
  companyName?: string;
  ticker?: string;
  fiscalYear?: number;
  reportingPeriod?: string;
  documentType?: DocumentType;
  metadataSources: Record<string, MetadataSource>;
}

export class DocumentStore {
  constructor(private readonly pool: Pool) {}

  /**
   * Insert a new document, or return the existing one for this owner if the
   * same file content was uploaded before (idempotent re-upload).
   */
  async create(input: CreateDocumentInput): Promise<{ document: DocumentRecord; alreadyExisted: boolean }> {
    const existing = await this.pool.query<DocumentRow>(
      `${SELECT_WITH_CHUNK_COUNT} WHERE d.owner_id = $1 AND d.content_sha256 = $2 GROUP BY d.id`,
      [input.ownerId, input.contentSha256],
    );
    if (existing.rows.length > 0) {
      return { document: mapRow(existing.rows[0] as DocumentRow), alreadyExisted: true };
    }

    const result = await this.pool.query<DocumentRow>(
      `INSERT INTO documents
         (owner_id, file_name, content_sha256, size_bytes, storage_path,
          company_name, ticker, fiscal_year, reporting_period, document_type, metadata_sources)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *, 0 AS chunk_count`,
      [
        input.ownerId,
        input.fileName,
        input.contentSha256,
        input.sizeBytes,
        input.storagePath,
        input.companyName ?? null,
        input.ticker ?? null,
        input.fiscalYear ?? null,
        input.reportingPeriod ?? null,
        input.documentType ?? null,
        JSON.stringify(input.metadataSources),
      ],
    );
    return { document: mapRow(result.rows[0] as DocumentRow), alreadyExisted: false };
  }

  async findById(ownerId: string, id: string): Promise<DocumentRecord | null> {
    const result = await this.pool.query<DocumentRow>(
      `${SELECT_WITH_CHUNK_COUNT} WHERE d.owner_id = $1 AND d.id = $2 GROUP BY d.id`,
      [ownerId, id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async requireById(ownerId: string, id: string): Promise<DocumentRecord> {
    const doc = await this.findById(ownerId, id);
    if (!doc) throw new NotFoundError(`Document ${id} not found.`);
    return doc;
  }

  async list(ownerId: string, opts: { limit?: number; offset?: number } = {}): Promise<DocumentRecord[]> {
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const result = await this.pool.query<DocumentRow>(
      `${SELECT_WITH_CHUNK_COUNT} WHERE d.owner_id = $1 GROUP BY d.id ORDER BY d.created_at DESC LIMIT $2 OFFSET $3`,
      [ownerId, limit, offset],
    );
    return result.rows.map(mapRow);
  }

  async setStatus(id: string, status: DocumentStatus, errorMessage: string | null = null): Promise<void> {
    await this.pool.query(
      `UPDATE documents SET status = $2, error_message = $3, updated_at = now() WHERE id = $1`,
      [id, status, errorMessage],
    );
  }

  /** Apply heuristically-derived metadata without overwriting fields the user already supplied. */
  async applyDerivedMetadata(
    id: string,
    derived: Partial<{ companyName: string; fiscalYear: number; reportingPeriod: string; documentType: DocumentType }>,
    pageCount: number,
  ): Promise<void> {
    const current = await this.pool.query<{ metadata_sources: Record<string, MetadataSource>; company_name: string | null; fiscal_year: number | null; reporting_period: string | null; document_type: string | null }>(
      `SELECT metadata_sources, company_name, fiscal_year, reporting_period, document_type FROM documents WHERE id = $1`,
      [id],
    );
    const row = current.rows[0];
    if (!row) throw new NotFoundError(`Document ${id} not found.`);
    const sources = { ...row.metadata_sources };

    const next = {
      companyName: row.company_name,
      fiscalYear: row.fiscal_year,
      reportingPeriod: row.reporting_period,
      documentType: row.document_type,
    };
    if (row.company_name === null && derived.companyName) {
      next.companyName = derived.companyName;
      sources.companyName = "heuristic";
    }
    if (row.fiscal_year === null && derived.fiscalYear !== undefined) {
      next.fiscalYear = derived.fiscalYear;
      sources.fiscalYear = "heuristic";
    }
    if (row.reporting_period === null && derived.reportingPeriod) {
      next.reportingPeriod = derived.reportingPeriod;
      sources.reportingPeriod = "heuristic";
    }
    if (row.document_type === null && derived.documentType) {
      next.documentType = derived.documentType;
      sources.documentType = "heuristic";
    }

    await this.pool.query(
      `UPDATE documents
          SET company_name = $2, fiscal_year = $3, reporting_period = $4, document_type = $5,
              page_count = $6, metadata_sources = $7, updated_at = now()
        WHERE id = $1`,
      [id, next.companyName, next.fiscalYear, next.reportingPeriod, next.documentType, pageCount, JSON.stringify(sources)],
    );
  }

  async deleteChunks(client: PoolClient, documentId: string): Promise<void> {
    await client.query(`DELETE FROM document_chunks WHERE document_id = $1`, [documentId]);
  }
}

export interface ChunkToInsert {
  documentId: string;
  chunkIndex: number;
  pageNumber: number;
  chunkType: ChunkType;
  content: string;
  metadata: ChunkMetadata;
  embedding: number[];
  embeddingModel: string;
}

/** Bulk-insert chunks for one document inside an existing transaction. */
export async function insertChunks(client: PoolClient, chunks: ChunkToInsert[]): Promise<void> {
  for (const chunk of chunks) {
    await client.query(
      `INSERT INTO document_chunks
         (document_id, chunk_index, page_number, chunk_type, content, metadata, embedding, embedding_model)
       VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8)`,
      [
        chunk.documentId,
        chunk.chunkIndex,
        chunk.pageNumber,
        chunk.chunkType,
        chunk.content,
        JSON.stringify(chunk.metadata),
        toVectorLiteral(chunk.embedding),
        chunk.embeddingModel,
      ],
    );
  }
}
