---
name: architecture:document-processing
description: Document upload and conversion pipeline — how files move from the browser to the agent workspace via Content Understanding and ADLS.
---

# Document Processing Pipeline

## End-to-End Flow

```
Browser
  POST /sessions/{id}/upload  (multipart, 50 MB limit)
    ↓
Orchestrator: SessionManager.upload_file()
  1. Read file content (enforces 50 MB limit)
  2. POST to session container /upload  → file saved to WORKSPACE
  3. Check content_processor.enabled (requires ADLS + CU configured)
  4. ContentProcessor.process_document():
       a. Upload original to ADLS blob storage
       b. Convert to markdown:
          - Text-based files (text/*, application/json, application/xml, application/csv):
            decoded directly as UTF-8 — Content Understanding is NOT called
          - Binary files (PDF, DOCX, etc.): Azure Content Understanding → get markdown
       c. Upload markdown to ADLS (markdown/{session_id}/{filename}.md)
       d. forward_markdown_fn: POST markdown as <filename>.md to session container /upload
  5. Return {markdown_ready: true} to frontend
```

**CU is required — there is no fallback.** If `ADLS_ACCOUNT_NAME` is not set or Content Understanding fails to initialize, `ContentProcessor.enabled` is `False` and upload returns **503**.

## Session Container /upload

`server.py` enforces:
- **Extension allowlist:** `.pdf .doc .docx .txt .csv .json .xml .md .xlsx .pptx .xls .rtf .html .htm`
- **50 MB limit** (streaming, enforced during write)
- **Path traversal prevention:** `os.path.realpath(dest)` must be under `WORKSPACE`
- **Filename sanitization:** `PurePosixPath(raw_name).name` strips directory components
- **Upload manifest:** `.uploaded_files.json` in WORKSPACE tracks which files were user-uploaded vs agent-generated (determines `origin` field in `/files` response)

## File Listing

`GET /sessions/{id}/files` returns each workspace file with:
- `filename`, `size`, `modified_at`
- `has_markdown` — whether a `.md` sibling exists (used by frontend to show conversion status)
- `origin` — `"uploaded"` (in manifest) or `"generated"` (agent-created)

The frontend's `normalizeFileList` hides `.md` files when their source file (filename without the `.md` suffix) also exists in the list. This means the raw source file is shown, not the markdown version. `.md` files are only shown if there is no matching source file (e.g., agent-generated markdown documents).

## Env Vars

| Var | Purpose |
|---|---|
| `ADLS_ACCOUNT_NAME` | Required for CU pipeline |
| `AZURE_ENDPOINT` | Azure OpenAI endpoint (also used by CU) |
| `CHAT_TIMEOUT_SECONDS` | Per-turn timeout (default 300) — not directly related but same container |
