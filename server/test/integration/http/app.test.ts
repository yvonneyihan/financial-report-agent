import path from "node:path";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/http/app.js";
import { DocumentStore } from "../../../src/infra/db/documentStore.js";
import { LocalDocumentStorage } from "../../../src/infra/storage.js";
import { PythonServiceClient } from "../../../src/infra/python/client.js";
import { FakeEmbeddings } from "../../../src/infra/llm/embeddings.js";
import { assertEmbeddingSchema } from "../../../src/infra/db/migrate.js";
import { getMigratedTestPool, truncateAll } from "../../helpers/db.js";
import { startPythonService, type RunningPythonService } from "../../helpers/pythonService.js";
import { FakeStructuredChatModel } from "../../helpers/fakeChatModel.js";
import type { Pool } from "../../../src/infra/db/pool.js";

const FIXTURE = path.resolve(import.meta.dirname, "../../../../tests/fixtures/acme_annual_report_fy2024.pdf");
const DIMENSIONS = 64;

describe.skipIf(!process.env["RUN_INTEGRATION_TESTS"])("HTTP app (real Postgres + finance-core, fake LLM/embeddings)", () => {
  let pool: Pool;
  let python: RunningPythonService;
  let app: FastifyInstance;
  let baseUrl: string;
  let chatModel: FakeStructuredChatModel;

  beforeAll(async () => {
    python = await startPythonService(8100);
    pool = await getMigratedTestPool();
  }, 20_000);

  afterAll(async () => {
    await app?.close();
    await python.stop();
  });

  beforeEach(async () => {
    await truncateAll(pool);
    const documentStore = new DocumentStore(pool);
    const storage = new LocalDocumentStorage(path.resolve(import.meta.dirname, "../../../data/test-uploads"));
    const pythonClient = new PythonServiceClient({ baseUrl: python.baseUrl, token: python.token, timeoutMs: 15_000 });
    const embeddings = new FakeEmbeddings(DIMENSIONS);
    chatModel = new FakeStructuredChatModel({ responses: [] });
    const schemaInfo = await assertEmbeddingSchema(pool, DIMENSIONS);

    const ingestionDeps = { pool, documentStore, storage, pythonClient, embeddings, embeddingModel: "fake" };
    app = await buildApp({
      pool,
      documentStore,
      storage,
      pythonClient,
      embeddings,
      chatModel,
      ingestionDeps,
      apiKeys: [
        { key: "key-a", ownerId: "owner-a" },
        { key: "key-b", ownerId: "owner-b" },
      ],
      llmModelName: "claude-opus-4-6",
      maxUploadBytes: 50 * 1024 * 1024,
      retrievalTopK: 8,
      minRelevance: undefined,
      supportsIterativeScan: schemaInfo.supportsIterativeScan,
      logLevel: "silent",
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (typeof address !== "object" || address === null) throw new Error("Server did not bind to a port");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await app.close();
  });

  async function uploadFixture(apiKey: string, extraFields: Record<string, string> = {}) {
    const bytes = await readFile(FIXTURE);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), "acme_annual_report_fy2024.pdf");
    for (const [k, v] of Object.entries(extraFields)) form.append(k, v);
    return fetch(`${baseUrl}/api/v1/documents`, { method: "POST", headers: { "X-API-Key": apiKey }, body: form });
  }

  it("rejects requests with no API key", async () => {
    const res = await fetch(`${baseUrl}/api/v1/documents`);
    expect(res.status).toBe(401);
  });

  it("rejects requests with an unknown API key", async () => {
    const res = await fetch(`${baseUrl}/api/v1/documents`, { headers: { "X-API-Key": "not-a-real-key" } });
    expect(res.status).toBe(401);
  });

  it("serves /health without authentication", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("uploads, ingests, and lists a document end to end; a second owner sees nothing", async () => {
    const uploadRes = await uploadFixture("key-a", { companyName: "Acme Corp" });
    expect(uploadRes.status).toBe(201);
    const uploaded = (await uploadRes.json()) as { id: string; status: string; companyName: string };
    expect(uploaded.status).toBe("ready");
    expect(uploaded.companyName).toBe("Acme Corp"); // user-supplied value, not overwritten by the heuristic

    const listRes = await fetch(`${baseUrl}/api/v1/documents`, { headers: { "X-API-Key": "key-a" } });
    const list = (await listRes.json()) as { documents: Array<{ id: string }> };
    expect(list.documents.map((d) => d.id)).toContain(uploaded.id);

    const otherOwnerList = await fetch(`${baseUrl}/api/v1/documents`, { headers: { "X-API-Key": "key-b" } });
    const otherList = (await otherOwnerList.json()) as { documents: unknown[] };
    expect(otherList.documents).toHaveLength(0);
  });

  it("re-uploading the identical file for the same owner is idempotent (200, same id)", async () => {
    const first = await uploadFixture("key-a");
    const firstBody = (await first.json()) as { id: string };
    const second = await uploadFixture("key-a");
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { id: string };
    expect(secondBody.id).toBe(firstBody.id);
  });

  it("rejects a non-PDF upload", async () => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(Buffer.from("hello"))], { type: "text/plain" }), "notes.txt");
    const res = await fetch(`${baseUrl}/api/v1/documents`, { method: "POST", headers: { "X-API-Key": "key-a" }, body: form });
    expect(res.status).toBe(400);
  });

  it("/ask returns an insufficient answer with no LLM call when no documents are uploaded", async () => {
    const res = await fetch(`${baseUrl}/api/v1/ask`, {
      method: "POST",
      headers: { "X-API-Key": "key-a", "content-type": "application/json" },
      body: JSON.stringify({ question: "What was Acme's revenue?" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sufficient: boolean; citations: unknown[] };
    expect(body.sufficient).toBe(false);
    expect(body.citations).toEqual([]);
  });

  it("/ask returns a grounded, cited answer once a document is ingested", async () => {
    const uploadRes = await uploadFixture("key-a");
    expect(uploadRes.status).toBe(201);

    chatModel.pushResponse({
      parsed: {
        sufficient: true,
        answer: "Acme's revenue was $1,120 million in fiscal 2024 [S1].",
        citations: [{ label: "S1", quote: "Revenue" }],
      },
    });

    const res = await fetch(`${baseUrl}/api/v1/ask`, {
      method: "POST",
      headers: { "X-API-Key": "key-a", "content-type": "application/json" },
      body: JSON.stringify({ question: "What was Acme's revenue in fiscal 2024?" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sufficient: boolean; citations: Array<{ documentName: string; page: number }> };
    expect(body.sufficient).toBe(true);
    expect(body.citations).toHaveLength(1);
    expect(body.citations[0]?.documentName).toBe("acme_annual_report_fy2024.pdf");
  });

  it("/search returns retrieved chunks without calling the LLM", async () => {
    await uploadFixture("key-a");
    const res = await fetch(`${baseUrl}/api/v1/search`, {
      method: "POST",
      headers: { "X-API-Key": "key-a", "content-type": "application/json" },
      body: JSON.stringify({ query: "revenue" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[] };
    expect(Array.isArray(body.results)).toBe(true);
  });

  it("returns 404 for a document belonging to a different owner", async () => {
    const uploadRes = await uploadFixture("key-a");
    const { id } = (await uploadRes.json()) as { id: string };
    const res = await fetch(`${baseUrl}/api/v1/documents/${id}`, { headers: { "X-API-Key": "key-b" } });
    expect(res.status).toBe(404);
  });
});
