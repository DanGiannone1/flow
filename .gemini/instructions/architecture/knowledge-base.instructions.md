---
name: architecture:knowledge-base
description: Foundry IQ knowledge base — Azure AI Search agentic retrieval setup, MCP integration, and RBAC.
---

# Knowledge Base (Foundry IQ)

Optional feature. When `AZURE_SEARCH_ENDPOINT` is set, the agent gains a `knowledge_base_retrieve` tool to search indexed documents.

## What's Indexed

Past proposals and engagement letters, boilerplate/approved language, personnel bios, case studies, compliance/regulatory documents, pricing frameworks, certifications, and branding guidelines. Stored in ADLS; Azure AI Search auto-indexes from the ADLS container.

## Setup (One-Time)

```bash
# 1. Create Azure AI Search resource (Basic tier minimum)
# 2. Create knowledge source + knowledge base
uv run python setup_knowledge_base.py

# 3. Upload sample data PDFs to ADLS for indexing
uv run python index_knowledge_base.py
```

## How the Agent Connects

In `AgentSession.__aenter__()` (`agent.py`), when `AZURE_SEARCH_ENDPOINT` is set:

1. Fetches a managed identity token for `https://search.azure.com/.default`
2. Adds an MCP server entry to `session_config["mcp_servers"]`:
   ```
   URL: {AZURE_SEARCH_ENDPOINT}/knowledgebases/{AZURE_SEARCH_KB_NAME}/mcp?api-version=2025-11-01-preview
   Headers: Authorization: Bearer <token>
   Tools: ["knowledge_base_retrieve"]
   ```
3. The Copilot SDK exposes `knowledge_base_retrieve` as a tool automatically — no custom tool code needed.

When `AZURE_SEARCH_ENDPOINT` is **not** set, the system prompt tells the agent the tool is unavailable and to substitute with file-based search (`bash`, `grep`, `glob`).

## Env Vars

| Var | Required | Default |
|---|---|---|
| `AZURE_SEARCH_ENDPOINT` | Yes (to enable) | — |
| `AZURE_SEARCH_KEY` | Yes (for setup scripts) | — |
| `AZURE_SEARCH_KB_NAME` | No | `tax-knowledge` |

Set all three in both the root `.env` (for setup scripts) and the session container environment (for the agent).

## RBAC Requirements

| Principal | Role | Resource |
|---|---|---|
| Search service managed identity | Storage Blob Data Reader | ADLS |
| Search service managed identity | Cognitive Services User | Foundry resource |
| App managed identity | Search Index Data Reader | Azure AI Search |
| App managed identity | Search Service Contributor | Azure AI Search |
