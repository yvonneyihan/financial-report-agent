/**
 * Domain schemas (Zod) — the single source of truth for shapes that cross module
 * boundaries: Python service responses, API requests/responses, retrieval results.
 * No I/O in this layer.
 */
import { z } from "zod";

// ── Enumerations ───────────────────────────────────────────────────────────

export const DocumentStatusSchema = z.enum(["queued", "processing", "ready", "failed"]);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const DocumentTypeSchema = z.enum(["10-K", "10-Q", "annual-report", "earnings-release", "other"]);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const ChunkTypeSchema = z.enum(["text", "table"]);
export type ChunkType = z.infer<typeof ChunkTypeSchema>;

export const UnitsSchema = z.enum(["thousands", "millions", "billions"]);
export type Units = z.infer<typeof UnitsSchema>;

// ── Python service wire format (snake_case, as emitted by src/internal_api.py) ──

export const ParsedTableSchema = z.object({
  page_number: z.number().int().min(1),
  rows: z.array(z.array(z.string())),
});
export const ParsedPageSchema = z.object({
  page_number: z.number().int().min(1),
  text: z.string(),
  tables: z.array(ParsedTableSchema),
});
export const ParsedDocumentSchema = z.object({
  page_count: z.number().int().min(0),
  pages: z.array(ParsedPageSchema),
});
export type ParsedTable = z.infer<typeof ParsedTableSchema>;
export type ParsedPage = z.infer<typeof ParsedPageSchema>;
export type ParsedDocument = z.infer<typeof ParsedDocumentSchema>;

// ── Documents ──────────────────────────────────────────────────────────────

/** Financial context attached to every chunk so numbers are never separated from their units/periods. */
export const ChunkMetadataSchema = z.object({
  section: z.string().optional(),
  units: UnitsSchema.optional(),
  currency: z.string().optional(),
  periods: z.array(z.number().int()).optional(),
  tableSource: z.enum(["detected", "text-aligned"]).optional(),
});
export type ChunkMetadata = z.infer<typeof ChunkMetadataSchema>;

/** Optional user-supplied metadata on upload (multipart fields arrive as strings). */
export const UploadMetadataSchema = z.object({
  companyName: z.string().trim().min(1).max(200).optional(),
  ticker: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9.\-]{0,9}$/, "ticker must be 1-10 characters (A-Z, 0-9, '.', '-')")
    .optional(),
  fiscalYear: z.coerce.number().int().min(1900).max(2100).optional(),
  reportingPeriod: z.string().trim().min(1).max(50).optional(),
  documentType: DocumentTypeSchema.optional(),
});
export type UploadMetadata = z.infer<typeof UploadMetadataSchema>;

export type MetadataSource = "user" | "heuristic";

export interface DocumentRecord {
  id: string;
  ownerId: string;
  fileName: string;
  contentSha256: string;
  sizeBytes: number;
  storagePath: string;
  status: DocumentStatus;
  errorMessage: string | null;
  companyName: string | null;
  ticker: string | null;
  fiscalYear: number | null;
  reportingPeriod: string | null;
  documentType: DocumentType | null;
  pageCount: number | null;
  metadataSources: Record<string, MetadataSource>;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Public view of a document (drops storage internals and owner). */
export type DocumentView = Omit<DocumentRecord, "ownerId" | "storagePath" | "contentSha256">;

export function toDocumentView(d: DocumentRecord): DocumentView {
  const { ownerId: _o, storagePath: _s, contentSha256: _h, ...view } = d;
  return view;
}

// ── Retrieval ──────────────────────────────────────────────────────────────

export const RetrievalFiltersSchema = z.object({
  documentIds: z.array(z.string().uuid()).max(50).optional(),
  /** Case-insensitive substring match against the document's company name. */
  company: z.string().trim().min(1).max(200).optional(),
  ticker: z.string().trim().toUpperCase().min(1).max(10).optional(),
  fiscalYears: z.array(z.number().int().min(1900).max(2100)).max(20).optional(),
});
export type RetrievalFilters = z.infer<typeof RetrievalFiltersSchema>;

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  fileName: string;
  companyName: string | null;
  ticker: string | null;
  fiscalYear: number | null;
  reportingPeriod: string | null;
  documentType: DocumentType | null;
  pageNumber: number;
  chunkType: ChunkType;
  content: string;
  metadata: ChunkMetadata;
  /** Cosine similarity in [-1, 1]; higher is more similar. */
  score: number;
}

export const SearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  filters: RetrievalFiltersSchema.optional(),
  topK: z.number().int().min(1).max(50).optional(),
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

// ── Question answering ─────────────────────────────────────────────────────

export const AskRequestSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  filters: RetrievalFiltersSchema.optional(),
  topK: z.number().int().min(1).max(50).optional(),
});
export type AskRequest = z.infer<typeof AskRequestSchema>;

export interface Citation {
  /** Label the model used in the answer text, e.g. "S2". */
  label: string;
  chunkId: string;
  documentId: string;
  documentName: string;
  page: number;
  company: string | null;
  fiscalYear: number | null;
  /** Verbatim text found in the cited chunk, or null if the model's quote could not be verified. */
  quote: string | null;
}

export type WarningCode =
  | "invalid_citation_removed"
  | "unverified_quote"
  | "no_valid_citations"
  | "ungrounded_numbers";

export interface AnswerWarning {
  code: WarningCode;
  message: string;
}

export interface AskResponse {
  answer: string;
  /** False when the documents do not contain enough information to answer. */
  sufficient: boolean;
  citations: Citation[];
  warnings: AnswerWarning[];
  /** Numbers in the answer that do not appear in any retrieved passage (possible model arithmetic or error). */
  ungroundedNumbers: string[];
  retrieval: { chunkCount: number; topScore: number | null; latencyMs: number };
  usage: { inputTokens: number; outputTokens: number } | null;
  model: string | null;
  latencyMs: number;
}
