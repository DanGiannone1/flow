---
name: architecture:session-lifecycle
description: Session creation, validation, deletion, and auth token forwarding in the RFP Agent.
---

# Session Lifecycle

## Session IDs

Format: `uuid4().hex[:16]` — exactly **16 lowercase hex characters**.
Validated by regex `^[0-9a-f]{16}$` before any health probe (prevents local dev from accepting arbitrary IDs since `/health` always returns 200 regardless of identifier).

## create_session

```
POST /sessions  →  SessionManager.create_session()
```

1. **Local dev** (`POOL_MANAGEMENT_ENDPOINT` starts with `http://`):
   POST `/reset?identifier={id}` to shared container — destroys agent singleton and clears workspace, simulating a fresh container.
2. **Production** (`https://`): ACA pool allocates a fresh container; no reset needed.
3. Both: GET `/health?identifier={id}` to warm up/allocate the container.
4. Add `session_id` to `_sessions` set; remove from `_deleted_sessions`.

## validate_session

Called before every request. Order of checks:
1. If in `_deleted_sessions` → raise `KeyError` (fast-path, avoids health probe after explicit delete)
2. If in `_sessions` → return (fast-path for known sessions)
3. Validate ID format with regex (reject malformed before probing — local `/health` always returns 200)
4. GET `/health?identifier={id}` — if successful, add to `_sessions` (handles orchestrator restart)

## delete_session

```
DELETE /sessions/{id}  →  SessionManager.delete_session()
```
1. POST `/reset?identifier={id}` (best-effort — logged but not fatal)
2. Remove from `_sessions`; add to `_deleted_sessions`

## Auth Token Forwarding

For production (`https://` pool endpoint):
- Orchestrator fetches a `DefaultAzureCredential` token for `https://cognitiveservices.azure.com/.default`
- Token cached with 60-second refresh buffer
- Forwarded to session container via `X-Cogservices-Token` request header on every `/chat/stream` call
- Session container uses this token as the Azure OpenAI bearer token (skips `DefaultAzureCredential` lookup)

For local dev (`http://`): token is `None`; session container uses `AZURE_OPENAI_TOKEN` env var or falls back to its own `DefaultAzureCredential`.

## Session Container Singleton

`server.py` holds `_session: AgentSession | None` at module level. Lazy-initialized on first request via `_get_or_create_session()`. Destroyed on timeout, unhandled exception, or `/reset`. The `asyncio.Lock` (`_lock`) serializes turns — only one agent turn at a time per container.

## Persistence

**None.** All state is in-memory (`_sessions: set[str]`, `_deleted_sessions: set[str]`). Orchestrator restart loses all sessions. Frontend stores `session_id` in `sessionStorage` and validates via `GET /sessions/{id}` on page load; if the session is gone, it creates a new one.
