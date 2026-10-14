import { setTimeout as delay } from "node:timers/promises";
import type { z } from "zod";
import { UnsupportedDocumentError, UpstreamError, ValidationError } from "../../domain/errors.js";
import { ParsedDocumentSchema, type ParsedDocument } from "../../domain/schemas.js";

export interface PythonClientConfig {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
}

/**
 * Typed client for `src/internal_api.py` (see IMPLEMENTATION_PLAN.md §2/§9-R10).
 * Every response is validated against a Zod schema before it crosses into the
 * rest of the TypeScript codebase — the Python side never gets to hand this
 * layer an unchecked shape.
 */
export class PythonServiceClient {
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;

  constructor(private readonly config: PythonClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.maxRetries = config.maxRetries ?? 2;
  }

  async health(): Promise<boolean> {
    try {
      const res = await this.request("GET", "/internal/v1/health");
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Parse a PDF into page-aware text/tables via POST /internal/v1/parse. */
  async parsePdf(fileBytes: Buffer, fileName: string): Promise<ParsedDocument> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(fileBytes)], { type: "application/pdf" }), fileName);

    const res = await this.request("POST", "/internal/v1/parse", { body: form });
    if (res.status === 422) {
      throw new UnsupportedDocumentError(await this.errorDetail(res));
    }
    if (res.status === 413) {
      throw new ValidationError(await this.errorDetail(res));
    }
    return this.parseJson(res, ParsedDocumentSchema);
  }

  private async request(method: string, path: string, init: { body?: FormData } = {}): Promise<Response> {
    const url = `${this.config.baseUrl}${path}`;
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          method,
          headers: { "X-Internal-Token": this.config.token },
          body: init.body,
          signal: controller.signal,
        });
        // Only retry server errors — a 4xx will not change on retry.
        if (res.status >= 500 && attempt < this.maxRetries) {
          lastError = new UpstreamError(`finance-core returned ${res.status}`);
          await delay(backoffMs(attempt));
          continue;
        }
        return res;
      } catch (err) {
        lastError = err;
        if (attempt < this.maxRetries) {
          await delay(backoffMs(attempt));
          continue;
        }
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new UpstreamError(`finance-core request failed: ${method} ${path}`, { cause: lastError });
  }

  private async parseJson<S extends z.ZodType>(res: Response, schema: S): Promise<z.infer<S>> {
    if (!res.ok) throw new UpstreamError(`finance-core returned ${res.status}: ${await this.errorDetail(res)}`);
    const json: unknown = await res.json();
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new UpstreamError(`finance-core response failed validation: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  private async errorDetail(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { detail?: string };
      return body.detail ?? res.statusText;
    } catch {
      return res.statusText;
    }
  }
}

function backoffMs(attempt: number): number {
  return Math.min(250 * 2 ** attempt, 2000);
}
