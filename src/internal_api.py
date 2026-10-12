"""Internal-only FastAPI service consumed by the TypeScript server.

This is NOT a public API.  The TypeScript (Fastify) server is the single public
entry point; this service exposes the existing, reliable Python financial logic
over HTTP on the private network.

Auth: every route except /internal/v1/health requires the ``X-Internal-Token``
header to equal the ``INTERNAL_API_TOKEN`` env var.  If the env var is unset the
service fails closed (503) rather than accepting unauthenticated calls.

Run:  uvicorn src.internal_api:app --port 8001

Routes:
  GET  /internal/v1/health
  POST /internal/v1/parse    multipart PDF → page-aware ParsedDocument
"""

from __future__ import annotations

import hmac
import os
import tempfile
from pathlib import Path
from typing import Annotated

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile, status

from src.parsers import PDFReadError, ParsedDocument, parse_pdf_pages

load_dotenv()

MAX_UPLOAD_BYTES = int(os.environ.get("INTERNAL_MAX_UPLOAD_BYTES", str(60 * 1024 * 1024)))

app = FastAPI(
    title="finance-core (internal)",
    description="Internal-only Python financial logic for the TypeScript server.",
    version="1.0.0",
)


def require_internal_token(
    x_internal_token: Annotated[str | None, Header()] = None,
) -> None:
    """Reject requests that do not carry the shared internal token."""
    expected = os.environ.get("INTERNAL_API_TOKEN")
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="INTERNAL_API_TOKEN is not configured on the service.",
        )
    if x_internal_token is None or not hmac.compare_digest(x_internal_token, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid internal token.")


TokenDep = Depends(require_internal_token)


@app.get("/internal/v1/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post(
    "/internal/v1/parse",
    response_model=ParsedDocument,
    dependencies=[TokenDep],
    summary="Parse a PDF into per-page text and tables",
)
def parse(file: Annotated[UploadFile, File(description="PDF file")]) -> ParsedDocument:
    """Parse an uploaded PDF, preserving page numbers.

    Declared as a sync ``def`` so FastAPI runs the CPU-bound pdfplumber work in
    its threadpool instead of blocking the event loop.
    """
    contents = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds {MAX_UPLOAD_BYTES} bytes.",
        )
    if not contents.startswith(b"%PDF-"):
        raise HTTPException(
            status_code=422,
            detail="Not a PDF file (missing %PDF- header).",
        )

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(contents)
        tmp_path = Path(tmp.name)

    try:
        return parse_pdf_pages(tmp_path)
    except PDFReadError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    finally:
        tmp_path.unlink(missing_ok=True)
