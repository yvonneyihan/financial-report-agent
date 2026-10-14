import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { UnsupportedDocumentError } from "../domain/errors.js";
import type { ParsedDocument } from "../domain/schemas.js";
import { insertChunks, type ChunkToInsert, type DocumentStore } from "../infra/db/documentStore.js";
import type { Pool } from "../infra/db/pool.js";
import { withTransaction } from "../infra/db/pool.js";
import type { PythonServiceClient } from "../infra/python/client.js";
import type { DocumentStorage } from "../infra/storage.js";
import { chunkPage } from "./chunker.js";
import { deriveDocumentMetadata } from "./metadata.js";

export interface IngestionDeps {
  pool: Pool;
  documentStore: DocumentStore;
  storage: DocumentStorage;
  pythonClient: PythonServiceClient;
  embeddings: EmbeddingsInterface;
  embeddingModel: string;
}

/**
 * Run the full ingestion pipeline for a document that is already persisted
 * (status='queued') with its bytes on disk: parse → chunk → embed → store.
 * Leaves the document 'ready' on success or 'failed' with `errorMessage` set
 * on any error — never throws, so a caller driving a queue/worker loop does
 * not need its own top-level try/catch per document.
 */
export async function ingestDocument(deps: IngestionDeps, documentId: string, ownerId: string): Promise<void> {
  try {
    await deps.documentStore.setStatus(documentId, "processing");
    const doc = await deps.documentStore.requireById(ownerId, documentId);

    const bytes = await deps.storage.read(doc.storagePath);
    const parsed = await deps.pythonClient.parsePdf(bytes, doc.fileName);

    if (parsed.pages.every((p) => p.text.trim().length === 0 && p.tables.length === 0)) {
      throw new UnsupportedDocumentError(
        `No extractable text or tables found in ${doc.fileName}. It may be a scanned image PDF (OCR is not supported).`,
      );
    }

    const derived = deriveDocumentMetadata(parsed);
    await deps.documentStore.applyDerivedMetadata(documentId, derived, parsed.page_count);

    const chunksToEmbed = await buildChunks(parsed);
    if (chunksToEmbed.length === 0) {
      throw new UnsupportedDocumentError(`${doc.fileName} produced no usable chunks after filtering.`);
    }

    const vectors = await deps.embeddings.embedDocuments(chunksToEmbed.map((c) => c.content));

    const rows: ChunkToInsert[] = chunksToEmbed.map((c, i) => ({
      documentId,
      chunkIndex: i,
      pageNumber: c.pageNumber,
      chunkType: c.chunkType,
      content: c.content,
      metadata: c.metadata,
      embedding: vectors[i] as number[],
      embeddingModel: deps.embeddingModel,
    }));

    await withTransaction(deps.pool, async (client) => {
      await deps.documentStore.deleteChunks(client, documentId);
      await insertChunks(client, rows);
    });

    await deps.documentStore.setStatus(documentId, "ready");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.documentStore.setStatus(documentId, "failed", message);
  }
}

async function buildChunks(parsed: ParsedDocument) {
  const perPage = await Promise.all(parsed.pages.map((p) => chunkPage(p)));
  return perPage.flat();
}
