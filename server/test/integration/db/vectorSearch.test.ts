import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { DocumentStore, insertChunks, type ChunkToInsert } from "../../../src/infra/db/documentStore.js";
import { vectorSearch } from "../../../src/infra/db/vectorSearch.js";
import { withTransaction, type Pool } from "../../../src/infra/db/pool.js";
import { FakeEmbeddings } from "../../../src/infra/llm/embeddings.js";
import { getMigratedTestPool, truncateAll } from "../../helpers/db.js";

const DIMENSIONS = 64;
const embeddings = new FakeEmbeddings(DIMENSIONS);

async function seedDocument(
  pool: Pool,
  store: DocumentStore,
  opts: { ownerId: string; company: string; fiscalYear: number; contents: string[]; status?: "ready" | "processing" },
) {
  const { document } = await store.create({
    ownerId: opts.ownerId,
    fileName: `${opts.company}.pdf`,
    contentSha256: randomUUID().replace(/-/g, "").padEnd(64, "0"),
    sizeBytes: 1,
    storagePath: "/x",
    companyName: opts.company,
    fiscalYear: opts.fiscalYear,
    metadataSources: {},
  });

  const vectors = await embeddings.embedDocuments(opts.contents);
  const rows: ChunkToInsert[] = opts.contents.map((content, i) => ({
    documentId: document.id,
    chunkIndex: i,
    pageNumber: i + 1,
    chunkType: "text",
    content,
    metadata: {},
    embedding: vectors[i] as number[],
    embeddingModel: "fake",
  }));
  await withTransaction(pool, async (client) => insertChunks(client, rows));
  await store.setStatus(document.id, opts.status ?? "ready");
  return document;
}

describe.skipIf(!process.env["RUN_INTEGRATION_TESTS"])("vectorSearch (real pgvector)", () => {
  let pool: Pool;
  let store: DocumentStore;

  beforeEach(async () => {
    pool = await getMigratedTestPool();
    await truncateAll(pool);
    store = new DocumentStore(pool);
  });

  it("ranks lexically closer chunks first", async () => {
    await seedDocument(pool, store, {
      ownerId: "owner-a",
      company: "Acme",
      fiscalYear: 2024,
      contents: ["Acme revenue grew to 1120 million dollars in fiscal 2024", "The cafeteria menu changed on Tuesday"],
    });

    const [queryEmbedding] = await Promise.all([embeddings.embedQuery("What was Acme revenue in fiscal 2024?")]);
    const results = await vectorSearch(pool, {
      ownerId: "owner-a",
      queryEmbedding,
      topK: 5,
      supportsIterativeScan: false,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.content).toContain("Acme revenue grew");
    expect(results[0]?.score).toBeGreaterThan(results[results.length - 1]?.score ?? 0);
  });

  it("does not return chunks belonging to another owner", async () => {
    await seedDocument(pool, store, { ownerId: "owner-a", company: "Acme", fiscalYear: 2024, contents: ["Acme secret figures"] });
    await seedDocument(pool, store, { ownerId: "owner-b", company: "Acme", fiscalYear: 2024, contents: ["Acme secret figures"] });

    const queryEmbedding = await embeddings.embedQuery("Acme secret figures");
    const results = await vectorSearch(pool, { ownerId: "owner-a", queryEmbedding, topK: 10, supportsIterativeScan: false });

    expect(results).toHaveLength(1);
  });

  it("excludes chunks belonging to documents that are not yet ready", async () => {
    await seedDocument(pool, store, { ownerId: "owner-a", company: "Acme", fiscalYear: 2024, contents: ["Acme figures"], status: "processing" });

    const queryEmbedding = await embeddings.embedQuery("Acme figures");
    const results = await vectorSearch(pool, { ownerId: "owner-a", queryEmbedding, topK: 10, supportsIterativeScan: false });

    expect(results).toHaveLength(0);
  });

  it("filters by company name (case-insensitive substring) and fiscal year", async () => {
    await seedDocument(pool, store, { ownerId: "owner-a", company: "Acme Corp", fiscalYear: 2023, contents: ["Acme 2023 figures"] });
    await seedDocument(pool, store, { ownerId: "owner-a", company: "Acme Corp", fiscalYear: 2024, contents: ["Acme 2024 figures"] });
    await seedDocument(pool, store, { ownerId: "owner-a", company: "Globex Inc", fiscalYear: 2024, contents: ["Globex 2024 figures"] });

    const queryEmbedding = await embeddings.embedQuery("figures");

    const byCompany = await vectorSearch(pool, {
      ownerId: "owner-a",
      queryEmbedding,
      topK: 10,
      supportsIterativeScan: false,
      filters: { company: "acme" },
    });
    expect(byCompany.every((r) => r.companyName === "Acme Corp")).toBe(true);
    expect(byCompany).toHaveLength(2);

    const byYear = await vectorSearch(pool, {
      ownerId: "owner-a",
      queryEmbedding,
      topK: 10,
      supportsIterativeScan: false,
      filters: { fiscalYears: [2024] },
    });
    expect(byYear.every((r) => r.fiscalYear === 2024)).toBe(true);
    expect(byYear).toHaveLength(2);
  });

  it("applies minRelevance as a floor on similarity", async () => {
    await seedDocument(pool, store, { ownerId: "owner-a", company: "Acme", fiscalYear: 2024, contents: ["Completely unrelated cafeteria menu text"] });
    const queryEmbedding = await embeddings.embedQuery("Acme quarterly revenue growth rate analysis");

    const results = await vectorSearch(pool, { ownerId: "owner-a", queryEmbedding, topK: 10, supportsIterativeScan: false, minRelevance: 0.99 });
    expect(results).toHaveLength(0);
  });

  it("respects topK", async () => {
    await seedDocument(pool, store, {
      ownerId: "owner-a",
      company: "Acme",
      fiscalYear: 2024,
      contents: ["chunk one about revenue", "chunk two about revenue", "chunk three about revenue"],
    });
    const queryEmbedding = await embeddings.embedQuery("revenue");
    const results = await vectorSearch(pool, { ownerId: "owner-a", queryEmbedding, topK: 2, supportsIterativeScan: false });
    expect(results).toHaveLength(2);
  });
});
