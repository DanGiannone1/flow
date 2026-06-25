# Retrieval & Document Processing

Flow handles documents in two layers — an ephemeral per-session workspace and a persistent,
indexed **Library** — and converts uploads to markdown on the way in.

## Two-tier document model

| Tier | Lives in | How the agent uses it |
|---|---|---|
| **Session files** | Per-session workspace folder | Listed with `list_documents`, read in full with `read_workspace_file`. Current and quick; ephemeral. |
| **Library** | Cosmos `library[]` + an Azure AI Search index | Searched with `search_documents`. Persistent and retrievable across sessions. |

A session file is promoted into the Library with `save_to_library(filename)`, which chunks the
document and indexes it (see [`session-container/library.py`](../session-container/library.py)).
`list_library()` enumerates what's indexed. This separation keeps "the document I'm working on right
now" distinct from "the corpus I can search."

## Retrieval (RAG)

`search_documents(query)` runs a semantic query against Azure AI Search and returns the top passages,
each prefixed with its source filename, so the agent can ground an answer and cite sources.

- **Index:** `flow-documents-index` · **semantic config:** `flow-semantic` · **API version:** `2024-07-01`
- **Auth:** `AZURE_SEARCH_ENDPOINT` + `AZURE_SEARCH_KEY` (admin key for this path)
- **Indexing:** `library.py` defines the index, chunks markdown, and writes/deletes documents

### Fail-loud contract

Retrieval has a hard Azure dependency, so `search_documents` never silently returns nothing — it
returns a leading status marker the agent is instructed to surface honestly rather than fabricate:

| Marker | Meaning |
|---|---|
| `SEARCH_NOT_CONFIGURED` | `AZURE_SEARCH_ENDPOINT` / `AZURE_SEARCH_KEY` missing |
| `SEARCH_FAILED` | Search unreachable or returned an error |
| `NO_RESULTS` | Nothing in the Library matched |

The `research` skill ([`session-container/skills/research/`](../session-container/skills/)) tells the
agent to answer only from returned passages, cite the source filename(s), and say plainly when search
is unavailable.

## Document upload and conversion

Uploads flow browser → orchestrator → session container, with optional markdown conversion:

```
Browser  POST /sessions/{id}/upload  (multipart, 50 MB limit)
   │
Orchestrator (SessionManager.upload_file)
   ├─ proxy to session container POST /upload  → saved to workspace, recorded in manifest
   └─ if ContentProcessor.enabled and not already markdown:
        ├─ store original to ADLS
        ├─ convert to markdown:
        │     text/* · json · xml · csv  → decoded directly as UTF-8 (no Content Understanding call)
        │     PDF · DOCX · …             → Azure Content Understanding (prebuilt-layout)
        └─ forward the markdown back to the session container as <filename>.md
```

The session container's `/upload` enforces an **extension allowlist** (`.pdf .doc .docx .txt .csv
.json .xml .md .xlsx .pptx .xls .rtf .html .htm`), the **50 MB** streaming limit, **filename
sanitisation**, and **path-traversal prevention** (the resolved path must stay under `WORKSPACE`).

`GET /sessions/{id}/files` returns each file with `size`, `modified_at`, an `origin`
(`uploaded` vs `generated`, from the manifest), and `has_markdown` (whether a converted `.md`
sibling exists). The frontend shows the source file and hides its `.md` sibling, so converted
markdown surfaces only for agent-generated documents that have no source.

## Configuration

| Var | Purpose |
|---|---|
| `AZURE_SEARCH_ENDPOINT` | Azure AI Search endpoint (enables retrieval) |
| `AZURE_SEARCH_KEY` | Azure AI Search admin key |
| `ADLS_ACCOUNT_NAME` | ADLS Gen2 account for upload originals + converted markdown |
| `ADLS_FILESYSTEM` | ADLS filesystem/container (default `documents`) |
| `AZURE_ENDPOINT` | Foundry resource; Content Understanding uses the same resource |

Retrieval and conversion are independent: the navigation / CRUD / document-drafting capabilities run
without either, but RAG requires Azure AI Search and binary-upload conversion requires Content
Understanding + ADLS.
