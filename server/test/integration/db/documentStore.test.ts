import { beforeEach, describe, expect, it } from "vitest";
import { DocumentStore } from "../../../src/infra/db/documentStore.js";
import { NotFoundError } from "../../../src/domain/errors.js";
import { getMigratedTestPool, truncateAll } from "../../helpers/db.js";

describe.skipIf(!process.env["RUN_INTEGRATION_TESTS"])("DocumentStore (real Postgres)", () => {
  let store: DocumentStore;

  beforeEach(async () => {
    const pool = await getMigratedTestPool();
    await truncateAll(pool);
    store = new DocumentStore(pool);
  });

  it("creates a document and finds it scoped to its owner", async () => {
    const { document, alreadyExisted } = await store.create({
      ownerId: "owner-a",
      fileName: "acme.pdf",
      contentSha256: "a".repeat(64),
      sizeBytes: 1234,
      storagePath: "/tmp/acme.pdf",
      companyName: "Acme Corp",
      metadataSources: { companyName: "user" },
    });

    expect(alreadyExisted).toBe(false);
    expect(document.status).toBe("queued");
    expect(document.chunkCount).toBe(0);

    const found = await store.findById("owner-a", document.id);
    expect(found?.fileName).toBe("acme.pdf");

    const wrongOwner = await store.findById("owner-b", document.id);
    expect(wrongOwner).toBeNull();
  });

  it("requireById throws NotFoundError for a missing document", async () => {
    await expect(store.requireById("owner-a", "00000000-0000-0000-0000-000000000000")).rejects.toThrow(NotFoundError);
  });

  it("is idempotent for the same owner + content hash", async () => {
    const input = {
      ownerId: "owner-a",
      fileName: "acme.pdf",
      contentSha256: "b".repeat(64),
      sizeBytes: 10,
      storagePath: "/tmp/x.pdf",
      metadataSources: {},
    };
    const first = await store.create(input);
    const second = await store.create(input);
    expect(first.document.id).toBe(second.document.id);
    expect(second.alreadyExisted).toBe(true);
  });

  it("allows the same content hash for two different owners as two separate documents", async () => {
    const base = { fileName: "acme.pdf", contentSha256: "c".repeat(64), sizeBytes: 10, storagePath: "/tmp/x.pdf", metadataSources: {} };
    const a = await store.create({ ...base, ownerId: "owner-a" });
    const b = await store.create({ ...base, ownerId: "owner-b" });
    expect(a.document.id).not.toBe(b.document.id);
  });

  it("lists documents newest first, scoped to owner", async () => {
    await store.create({ ownerId: "owner-a", fileName: "1.pdf", contentSha256: "1".repeat(64), sizeBytes: 1, storagePath: "/1", metadataSources: {} });
    await store.create({ ownerId: "owner-a", fileName: "2.pdf", contentSha256: "2".repeat(64), sizeBytes: 1, storagePath: "/2", metadataSources: {} });
    await store.create({ ownerId: "owner-b", fileName: "3.pdf", contentSha256: "3".repeat(64), sizeBytes: 1, storagePath: "/3", metadataSources: {} });

    const listed = await store.list("owner-a");
    expect(listed.map((d) => d.fileName)).toEqual(["2.pdf", "1.pdf"]);
  });

  it("setStatus updates status and error message", async () => {
    const { document } = await store.create({ ownerId: "owner-a", fileName: "f.pdf", contentSha256: "d".repeat(64), sizeBytes: 1, storagePath: "/f", metadataSources: {} });
    await store.setStatus(document.id, "failed", "parse error");
    const updated = await store.requireById("owner-a", document.id);
    expect(updated.status).toBe("failed");
    expect(updated.errorMessage).toBe("parse error");
  });

  describe("applyDerivedMetadata", () => {
    it("fills in fields the user did not supply, and tags them heuristic", async () => {
      const { document } = await store.create({
        ownerId: "owner-a",
        fileName: "f.pdf",
        contentSha256: "e".repeat(64),
        sizeBytes: 1,
        storagePath: "/f",
        companyName: "User-Provided Name",
        metadataSources: { companyName: "user" },
      });

      await store.applyDerivedMetadata(document.id, { companyName: "Derived Name", fiscalYear: 2024, documentType: "10-K" }, 12);

      const updated = await store.requireById("owner-a", document.id);
      expect(updated.companyName).toBe("User-Provided Name"); // user value wins
      expect(updated.fiscalYear).toBe(2024); // derived fills the gap
      expect(updated.documentType).toBe("10-K");
      expect(updated.pageCount).toBe(12);
      expect(updated.metadataSources).toEqual({ companyName: "user", fiscalYear: "heuristic", documentType: "heuristic" });
    });
  });
});
