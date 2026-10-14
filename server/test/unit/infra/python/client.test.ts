import { describe, expect, it, vi } from "vitest";
import { PythonServiceClient } from "../../../../src/infra/python/client.js";
import { UnsupportedDocumentError, UpstreamError, ValidationError } from "../../../../src/domain/errors.js";

const VALID_PARSED_DOC = { page_count: 1, pages: [{ page_number: 1, text: "hello", tables: [] }] };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("PythonServiceClient.parsePdf", () => {
  it("returns a validated ParsedDocument on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, VALID_PARSED_DOC));
    const client = new PythonServiceClient({ baseUrl: "http://x", token: "t", timeoutMs: 1000, fetchImpl });

    const result = await client.parsePdf(Buffer.from("%PDF-1.4"), "r.pdf");
    expect(result).toEqual(VALID_PARSED_DOC);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Internal-Token"]).toBe("t");
  });

  it("throws UpstreamError when the response fails schema validation", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { not: "the right shape" }));
    const client = new PythonServiceClient({ baseUrl: "http://x", token: "t", timeoutMs: 1000, fetchImpl, maxRetries: 0 });
    await expect(client.parsePdf(Buffer.from("x"), "r.pdf")).rejects.toThrow(UpstreamError);
  });

  it("maps 422 to UnsupportedDocumentError without retrying", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(422, { detail: "corrupt pdf" }));
    const client = new PythonServiceClient({ baseUrl: "http://x", token: "t", timeoutMs: 1000, fetchImpl });
    await expect(client.parsePdf(Buffer.from("x"), "r.pdf")).rejects.toThrow(UnsupportedDocumentError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps 413 to ValidationError without retrying", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(413, { detail: "too big" }));
    const client = new PythonServiceClient({ baseUrl: "http://x", token: "t", timeoutMs: 1000, fetchImpl });
    await expect(client.parsePdf(Buffer.from("x"), "r.pdf")).rejects.toThrow(ValidationError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries on 5xx and eventually succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { detail: "unavailable" }))
      .mockResolvedValueOnce(jsonResponse(200, VALID_PARSED_DOC));
    const client = new PythonServiceClient({ baseUrl: "http://x", token: "t", timeoutMs: 1000, fetchImpl, maxRetries: 2 });
    const result = await client.parsePdf(Buffer.from("x"), "r.pdf");
    expect(result.page_count).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 4xx other than the specially-handled ones (401)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { detail: "bad token" }));
    const client = new PythonServiceClient({ baseUrl: "http://x", token: "t", timeoutMs: 1000, fetchImpl, maxRetries: 3 });
    await expect(client.parsePdf(Buffer.from("x"), "r.pdf")).rejects.toThrow(UpstreamError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxRetries on persistent 5xx errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { detail: "down" }));
    const client = new PythonServiceClient({ baseUrl: "http://x", token: "t", timeoutMs: 1000, fetchImpl, maxRetries: 2 });
    await expect(client.parsePdf(Buffer.from("x"), "r.pdf")).rejects.toThrow(UpstreamError);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("retries and recovers from a network error (fetch throws)", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new TypeError("network down")).mockResolvedValueOnce(jsonResponse(200, VALID_PARSED_DOC));
    const client = new PythonServiceClient({ baseUrl: "http://x", token: "t", timeoutMs: 1000, fetchImpl, maxRetries: 1 });
    const result = await client.parsePdf(Buffer.from("x"), "r.pdf");
    expect(result.page_count).toBe(1);
  });
});

describe("PythonServiceClient.health", () => {
  it("returns true on a healthy response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const client = new PythonServiceClient({ baseUrl: "http://x", token: "t", timeoutMs: 1000, fetchImpl, maxRetries: 0 });
    expect(await client.health()).toBe(true);
  });

  it("returns false when the service is unreachable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("connection refused"));
    const client = new PythonServiceClient({ baseUrl: "http://x", token: "t", timeoutMs: 1000, fetchImpl, maxRetries: 0 });
    expect(await client.health()).toBe(false);
  });
});
