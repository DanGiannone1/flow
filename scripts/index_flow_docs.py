#!/usr/bin/env python
"""Index the Flow seed document library into a fresh Azure AI Search index.

Reads session-container/seed_docs/*.md, chunks each doc on markdown headings /
paragraphs, and uploads the chunks to a NEW index (`flow-documents-index`).

Retrieval approach: plain full-text search with a semantic configuration (BM25 +
semantic ranker when the service tier supports it). No custom vectors — keeps the
runtime tool free of any query-time embedding-auth dependency. The embeddings model
is reachable (verified) but vector search is intentionally not used here: full-text +
semantic is the simplest reliable path for this small markdown corpus.

Usage:
    uv run python scripts/index_flow_docs.py            # create + index
    uv run python scripts/index_flow_docs.py --recreate # drop and rebuild the index

Requires env (.env at repo root): AZURE_SEARCH_ENDPOINT, AZURE_SEARCH_KEY (admin).
Fails loud if Search is unconfigured or unreachable — never pretends to succeed.
"""

import argparse
import os
import re
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent
SEED_DIR = REPO_ROOT / "session-container" / "seed_docs"
INDEX_NAME = "flow-documents-index"
SEMANTIC_CONFIG = "flow-semantic"
API_VERSION = "2024-07-01"


def _env(name: str) -> str:
    val = os.getenv(name)
    if not val:
        sys.exit(f"SEARCH_NOT_CONFIGURED: missing required env var {name}")
    return val


def _heading_to_title(filename: str) -> str:
    return filename.removesuffix(".md").replace("-", " ")


def chunk_markdown(text: str) -> list[str]:
    """Split a markdown doc into chunks at level-1/2 headings.

    Each chunk keeps its heading plus the body up to the next heading. Falls back to
    paragraph chunks for content before any heading. Trivial whitespace-only chunks
    are dropped.
    """
    # Split keeping the heading line with its following body.
    parts = re.split(r"(?m)^(#{1,2}\s.*)$", text)
    chunks: list[str] = []
    # parts[0] is any preamble before the first heading.
    preamble = parts[0].strip()
    if preamble:
        chunks.append(preamble)
    # Remaining parts come in (heading, body) pairs.
    for i in range(1, len(parts), 2):
        heading = parts[i].strip()
        body = parts[i + 1].strip() if i + 1 < len(parts) else ""
        chunk = (heading + "\n" + body).strip() if body else heading
        if chunk:
            chunks.append(chunk)
    return [c for c in chunks if c.strip()]


def build_documents() -> list[dict]:
    if not SEED_DIR.is_dir():
        sys.exit(f"SEED_DOCS_MISSING: {SEED_DIR} does not exist")
    docs: list[dict] = []
    files = sorted(SEED_DIR.glob("*.md"))
    if not files:
        sys.exit(f"SEED_DOCS_EMPTY: no *.md files under {SEED_DIR}")
    for path in files:
        text = path.read_text(encoding="utf-8")
        title = _heading_to_title(path.name)
        for idx, chunk in enumerate(chunk_markdown(text)):
            docs.append(
                {
                    "id": f"{path.stem}--{idx}",
                    "filename": path.name,
                    "title": title,
                    "chunk": chunk,
                }
            )
    return docs


def index_definition(semantic: bool) -> dict:
    fields = [
        {"name": "id", "type": "Edm.String", "key": True, "filterable": True, "searchable": False},
        {"name": "filename", "type": "Edm.String", "filterable": True, "facetable": True, "searchable": True},
        {"name": "title", "type": "Edm.String", "searchable": True, "filterable": True},
        {"name": "chunk", "type": "Edm.String", "searchable": True, "analyzer": "en.microsoft"},
    ]
    definition: dict = {"name": INDEX_NAME, "fields": fields}
    if semantic:
        definition["semantic"] = {
            "configurations": [
                {
                    "name": SEMANTIC_CONFIG,
                    "prioritizedFields": {
                        "titleField": {"fieldName": "title"},
                        "prioritizedContentFields": [{"fieldName": "chunk"}],
                        "prioritizedKeywordsFields": [{"fieldName": "filename"}],
                    },
                }
            ]
        }
    return definition


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--recreate", action="store_true", help="Delete the index first")
    args = parser.parse_args()

    load_dotenv(REPO_ROOT / ".env")
    endpoint = _env("AZURE_SEARCH_ENDPOINT").rstrip("/")
    key = _env("AZURE_SEARCH_KEY")
    headers = {"api-key": key, "Content-Type": "application/json"}

    client = httpx.Client(base_url=endpoint, headers=headers, timeout=60)

    if args.recreate:
        resp = client.delete(f"/indexes/{INDEX_NAME}", params={"api-version": API_VERSION})
        if resp.status_code not in (204, 404):
            sys.exit(f"INDEX_DELETE_FAILED: {resp.status_code} {resp.text}")
        print(f"Deleted index {INDEX_NAME} (status {resp.status_code})")

    # Create index — try with semantic config, fall back to plain full-text if the
    # service tier rejects it. Fail loud on any other error.
    semantic_enabled = True
    resp = client.put(
        f"/indexes/{INDEX_NAME}",
        params={"api-version": API_VERSION},
        json=index_definition(semantic=True),
    )
    if resp.status_code in (200, 201):
        print(f"Created/updated index {INDEX_NAME} WITH semantic config '{SEMANTIC_CONFIG}'")
    elif resp.status_code == 400 and "semantic" in resp.text.lower():
        print(f"Semantic config rejected ({resp.text[:160]}); retrying as plain full-text index")
        semantic_enabled = False
        resp = client.put(
            f"/indexes/{INDEX_NAME}",
            params={"api-version": API_VERSION},
            json=index_definition(semantic=False),
        )
        if resp.status_code not in (200, 201):
            sys.exit(f"INDEX_CREATE_FAILED: {resp.status_code} {resp.text}")
        print(f"Created/updated index {INDEX_NAME} (full-text only)")
    else:
        sys.exit(f"INDEX_CREATE_FAILED: {resp.status_code} {resp.text}")

    docs = build_documents()
    actions = [{"@search.action": "mergeOrUpload", **d} for d in docs]
    resp = client.post(
        f"/indexes/{INDEX_NAME}/docs/index",
        params={"api-version": API_VERSION},
        json={"value": actions},
    )
    if resp.status_code not in (200, 201):
        sys.exit(f"UPLOAD_FAILED: {resp.status_code} {resp.text}")
    results = resp.json().get("value", [])
    failures = [r for r in results if not r.get("status")]
    if failures:
        sys.exit(f"UPLOAD_PARTIAL_FAILURE: {failures}")

    print(f"Uploaded {len(docs)} chunks from {len(set(d['filename'] for d in docs))} docs")
    print(f"semantic_enabled={semantic_enabled}")
    print("Indexed files:")
    for fn in sorted(set(d["filename"] for d in docs)):
        n = sum(1 for d in docs if d["filename"] == fn)
        print(f"  - {fn}: {n} chunks")


if __name__ == "__main__":
    main()
