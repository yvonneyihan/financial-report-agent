/** Application errors carry a stable machine-readable `code` and the HTTP status the API layer should use. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Caller sent something invalid (bad body, bad filter, bad file type). */
export class ValidationError extends AppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "validation_error", 400, options);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Missing or invalid API key.") {
    super(message, "unauthorized", 401);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, "not_found", 404);
  }
}

/** The document is syntactically fine to upload but cannot be processed (corrupt, scanned, empty). */
export class UnsupportedDocumentError extends AppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "unsupported_document", 422, options);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message: string) {
    super(message, "payload_too_large", 413);
  }
}

/** A dependency (Python service, LLM provider, embedding provider) failed. */
export class UpstreamError extends AppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "upstream_error", 502, options);
  }
}

/** Server is misconfigured (e.g. embedding dimensions do not match the database schema). */
export class ConfigError extends AppError {
  constructor(message: string) {
    super(message, "config_error", 500);
  }
}
