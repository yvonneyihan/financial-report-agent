"""Tests for the internal-only API used by the TypeScript server."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src.internal_api import app

FIXTURE = Path(__file__).parent / "fixtures" / "acme_annual_report_fy2024.pdf"
TOKEN = "test-internal-token"


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("INTERNAL_API_TOKEN", TOKEN)
    return TestClient(app)


def _post(client: TestClient, content: bytes, *, token: str | None = TOKEN, name: str = "r.pdf"):
    headers = {"X-Internal-Token": token} if token is not None else {}
    return client.post(
        "/internal/v1/parse",
        files={"file": (name, content, "application/pdf")},
        headers=headers,
    )


def test_health_needs_no_token(client: TestClient):
    assert client.get("/internal/v1/health").json() == {"status": "ok"}


def test_parse_returns_page_aware_document(client: TestClient):
    resp = _post(client, FIXTURE.read_bytes())
    assert resp.status_code == 200
    body = resp.json()
    assert body["page_count"] == 4
    assert body["pages"][2]["tables"][0]["page_number"] == 3


def test_parse_rejects_missing_token(client: TestClient):
    assert _post(client, FIXTURE.read_bytes(), token=None).status_code == 401


def test_parse_rejects_wrong_token(client: TestClient):
    assert _post(client, FIXTURE.read_bytes(), token="nope").status_code == 401


def test_fails_closed_when_token_not_configured(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)
    resp = _post(TestClient(app), FIXTURE.read_bytes(), token="anything")
    assert resp.status_code == 503


def test_parse_rejects_non_pdf_bytes(client: TestClient):
    assert _post(client, b"just some text").status_code == 422


def test_parse_rejects_corrupt_pdf(client: TestClient):
    assert _post(client, b"%PDF-1.4\ngarbage").status_code == 422


def test_parse_rejects_oversized_upload(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("src.internal_api.MAX_UPLOAD_BYTES", 10)
    assert _post(client, FIXTURE.read_bytes()).status_code == 413
