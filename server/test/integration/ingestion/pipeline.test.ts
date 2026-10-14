import path from "node:path";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DocumentStore } from "../../../src/infra/db/documentStore.js";
import { LocalDocumentStorage } from "../../../src/infra/storage.js";
import { PythonServiceClient } from "../../../src/infra/python/client.js";
import { FakeEmbeddings } from "../../../src/infra/llm/embeddings.js";
import { ingestDocument, type IngestionDeps } from "../../../src/ingestion/pipeline.js";
import { getMigratedTestPool, truncateAll } from "../../helpers/db.js";
import { startPythonService, type RunningPythonService } from "../../helpers/pythonService.js";
import type { Pool } from "../../../src/infra/db/pool.js";

const FIXTURE = path.resolve(import.meta.dirname, "../../../../tests/fixtures/acme_annual_report_fy2024.pdf");

describe.skipIf(!process.env["RUN_INTEGRATION_TESTS"])("ingestDocument (real Postgres + real finance-core)", () => {
  let pool: Pool;
  let store: DocumentStore;
  let python: RunningPythonService;
  let storage: LocalDocumentStorage;
  let deps: IngestionDeps;

  beforeAll(async () => {
    python = await startPythonService(8099);
  }, 20_000);

  afterAll(async () => {
    await python.stop();
  });

  beforeEach(async () => {
    pool = await getMigratedTestPool();
    await truncateAll(pool);
    store = new DocumentStore(pool);
    storage = new LocalDocumentStorage(path.resolve(import.meta.dirname, "../../../data/test-uploads"));
    deps = {
      pool,
      documentStore: store,
      storage,
      pythonClient: new PythonServiceClient({ baseUrl: python.baseUrl, token: python.token, timeoutMs: 15_000 }),
      embeddings: new FakeEmbeddings(64),
      embeddingModel: "fake",
    };
  });

  it("parses, chunks, embeds, and marks the document ready end to end", async () => {
    const bytes = await readFile(FIXTURE);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const storagePath = await storage.save("owner-a", sha256, bytes);

    const { document } = await store.create({
      ownerId: "owner-a",
      fileName: "acme_annual_report_fy2024.pdf",
      contentSha256: sha256,
      sizeBytes: bytes.length,
      storagePath,
      metadataSources: {},
    });

    await ingestDocument(deps, document.id, "owner-a");

    const finished = await store.requireById("owner-a", document.id);
    expect(finished.status).toBe("ready");
    expect(finished.errorMessage).toBeNull();
    expect(finished.pageCount).toBe(4);
    // Derived from the cover page (see ingestion/metadata.ts); user supplied none of these.
    expect(finished.documentType).toBe("10-K");
    expect(finished.fiscalYear).toBe(2024);
    expect(finished.metadataSources["documentType"]).toBe("heuristic");
    expect(finished.chunkCount).toBeGreaterThan(0);

    const chunks = await pool.query<{ chunk_type: string; page_number: number; content: string }>(
      "SELECT chunk_type, page_number, content FROM document_chunks WHERE document_id = $1 ORDER BY chunk_index",
      [document.id],
    );
    // The ruled income-statement table (page 3) and the borderless balance sheet (page 4)
    // must both survive as intact table chunks — see plan risk R1.
    const tableChunks = chunks.rows.filter((r) => r.chunk_type === "table");
    expect(tableChunks.some((c) => c.page_number === 3 && c.content.includes("Revenue"))).toBe(true);
    expect(tableChunks.some((c) => c.page_number === 4 && c.content.includes("Total assets 2,400 2,100"))).toBe(true);
  });

  it("marks the document failed (not throwing) when finance-core rejects the file", async () => {
    const bytes = Buffer.from("not a pdf");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const storagePath = await storage.save("owner-a", sha256, bytes);
    const { document } = await store.create({
      ownerId: "owner-a",
      fileName: "broken.pdf",
      contentSha256: sha256,
      sizeBytes: bytes.length,
      storagePath,
      metadataSources: {},
    });

    await expect(ingestDocument(deps, document.id, "owner-a")).resolves.toBeUndefined();

    const finished = await store.requireById("owner-a", document.id);
    expect(finished.status).toBe("failed");
    expect(finished.errorMessage).toBeTruthy();
  });
});
