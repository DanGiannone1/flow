---
name: architecture:dev-setup
description: Local development setup, commands, env vars, and Playwright testing for the RFP Agent.
---

# Development Setup

## Prerequisites

- Python 3.12+ with `uv`
- Node 18+ with `npm`
- `.env` file at repo root (copy from `.env.example`)

## Starting Everything

```bash
uv run dev.py   # hot-reload for all 3 services
```

Starts:
- `:8080` — session container (`session-container/` — `uv run uvicorn server:app`)
- `:8000` — orchestrator (root — `uv run uvicorn app:app`)
- `:3000` — frontend (`frontend/` — `npm run dev`)

## Required Env Vars (`.env`)

| Var | Purpose |
|---|---|
| `AZURE_ENDPOINT` | Azure OpenAI endpoint |
| `AZURE_DEPLOYMENT` | Model deployment name |
| `ADLS_ACCOUNT_NAME` | Storage account for document uploads |
| `AZURE_SEARCH_ENDPOINT` | AI Search endpoint (enables knowledge base) |
| `AZURE_SEARCH_KEY` | AI Search admin key (for setup scripts only — not in `.env.example`) |
| `AZURE_SEARCH_KB_NAME` | Knowledge base name (default: `tax-knowledge`) |
| `ADLS_FILESYSTEM` | ADLS container name (default: `documents`) |
| `POOL_MANAGEMENT_ENDPOINT` | Session container URL (default: `http://localhost:8080`) |
| `CHAT_TIMEOUT_SECONDS` | Per-turn agent timeout (default: 300) |
| `FRONTEND_URL` | Added to CORS allow-list (production only) |

## Restarting / Troubleshooting

**Always restart via dev.py — never kill individual service PIDs.**

`dev.py` owns all three child processes. Killing a child PID directly destabilises the process manager and takes down other services.

```bash
# Full restart
pkill -f dev.py; pkill -f uvicorn; sleep 1
uv run dev.py
```

If a service is unresponsive, restart everything — don't patch individual processes. Key invariants set by dev.py that must be preserved:

| Var | Value |
|---|---|
| `WORKSPACE` | `{repo_root}/workspace` |
| `POOL_MANAGEMENT_ENDPOINT` | `http://localhost:8080` |
| All `.env` vars | Loaded from repo root `.env` |

Running the session container manually without these (e.g. pointing `WORKSPACE` at `/tmp` or missing `.env`) will disable CU/ADLS and break uploads.

## Two Separate uv Projects

Root and `session-container/` are independent uv projects, each with their own `pyproject.toml` + `uv.lock`. When adding dependencies:
- Orchestrator-side: `uv add <pkg>` from repo root
- Session container: `uv add <pkg>` from `session-container/`

## Frontend Only

```bash
cd frontend && npm run dev      # dev server
cd frontend && npm run build    # production build
cd frontend && npm run lint     # eslint
```

## Playwright Tests

```bash
npx playwright test                                      # full suite (18 tests, 6 journeys)
npx playwright test -g "Journey 1"                       # chat conversation
npx playwright test -g "Journey 3: Document Conversion"  # CU/ADLS pipeline
npx playwright test -g "Journey 5"                       # security & error handling
```

Tests default to `localhost:8000` / `localhost:3000`. Override with env vars for CI:

```bash
API_URL=https://taxagent-app.example-env.eastus2.azurecontainerapps.io \
APP_URL=https://taxagent-frontend.example-env.eastus2.azurecontainerapps.io \
npx playwright test
```

**ADLS and Content Understanding are required** — tests will fail if these services are unavailable. There is no skip logic.

Use `data-testid` attributes for all Playwright selectors. Frontend uses `sessionStorage` (not `localStorage`) — clear it between test sessions to avoid state bleed.
