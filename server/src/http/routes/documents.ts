import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { MultipartFile, MultipartValue } from "@fastify/multipart";
import { z } from "zod";
import { UploadMetadataSchema, toDocumentView } from "../../domain/schemas.js";
import { PayloadTooLargeError, ValidationError } from "../../domain/errors.js";
import type { DocumentStore } from "../../infra/db/documentStore.js";
import type { DocumentStorage } from "../../infra/storage.js";
import type { IngestionDeps } from "../../ingestion/pipeline.js";
import { ingestDocument } from "../../ingestion/pipeline.js";

export interface DocumentsRouteDeps {
  documentStore: DocumentStore;
  storage: DocumentStorage;
  ingestionDeps: IngestionDeps;
  maxUploadBytes: number;
}

function isFilePart(part: unknown): part is MultipartFile {
  return typeof part === "object" && part !== null && (part as { type?: string }).type === "file";
}

function fieldValue(part: unknown): string | undefined {
  if (typeof part === "object" && part !== null && (part as { type?: string }).type === "field") {
    const value = (part as MultipartValue).value;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

export async function registerDocumentRoutes(app: FastifyInstance, deps: DocumentsRouteDeps) {
  app.post("/documents", async (request, reply) => {
    const body = request.body as Record<string, unknown> | undefined;
    const filePart = body?.["file"];
    if (!isFilePart(filePart)) throw new ValidationError("Missing 'file' field (a PDF upload).");
    if (!filePart.filename.toLowerCase().endsWith(".pdf") || filePart.mimetype !== "application/pdf") {
      throw new ValidationError("Only application/pdf uploads are supported.");
    }

    const bytes = await filePart.toBuffer();
    if (bytes.length === 0) throw new ValidationError("Uploaded file is empty.");
    if (bytes.length > deps.maxUploadBytes) {
      throw new PayloadTooLargeError(`File exceeds the ${deps.maxUploadBytes}-byte upload limit.`);
    }

    const metadataInput = UploadMetadataSchema.parse({
      companyName: fieldValue(body?.["companyName"]),
      ticker: fieldValue(body?.["ticker"]),
      fiscalYear: fieldValue(body?.["fiscalYear"]),
      reportingPeriod: fieldValue(body?.["reportingPeriod"]),
      documentType: fieldValue(body?.["documentType"]),
    });

    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    const storagePath = await deps.storage.save(request.ownerId, contentSha256, bytes);

    const metadataSources: Record<string, "user"> = {};
    for (const key of Object.keys(metadataInput) as (keyof typeof metadataInput)[]) {
      if (metadataInput[key] !== undefined) metadataSources[key] = "user";
    }

    const { document, alreadyExisted } = await deps.documentStore.create({
      ownerId: request.ownerId,
      fileName: filePart.filename,
      contentSha256,
      sizeBytes: bytes.length,
      storagePath,
      ...metadataInput,
      metadataSources,
    });

    if (!alreadyExisted) {
      // Ingestion runs inline before responding — see IMPLEMENTATION_PLAN.md §9-R6 for
      // why this is a deliberate simplification (no durable job queue yet) rather than
      // an oversight, and what a production version would add.
      await ingestDocument(deps.ingestionDeps, document.id, request.ownerId);
    }

    const finalDoc = await deps.documentStore.requireById(request.ownerId, document.id);
    reply.code(alreadyExisted ? 200 : 201).send(toDocumentView(finalDoc));
  });

  const ListQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  });

  app.get("/documents", async (request) => {
    const query = ListQuerySchema.parse(request.query);
    const documents = await deps.documentStore.list(request.ownerId, query);
    return { documents: documents.map(toDocumentView) };
  });

  const ParamsSchema = z.object({ id: z.string().uuid() });

  app.get("/documents/:id", async (request) => {
    const { id } = ParamsSchema.parse(request.params);
    const document = await deps.documentStore.requireById(request.ownerId, id);
    return toDocumentView(document);
  });
}
