# System Architecture

Flow is a three-tier system. A Next.js frontend talks to a FastAPI **orchestrator**, which proxies
every agent interaction to an isolated **session container** that runs the agent. The orchestrator
never runs the agent SDK itself — it is a streaming proxy with auth forwarding. This boundary is
what makes the [agent harness swappable](harnesses.md).

```
Frontend (Next.js 16, React 19)         :3000
    │  HTTP + SSE (Server-Sent Events)
    ▼
Orchestrator (FastAPI)                  :8000   (the repo root: app.py, session_manager.py, scheduler.py)
    │   • SSE proxy + auth forwarding — never runs the agent SDK
    │   • upload conversion → ADLS + Azure Content Understanding (CU)
    │   • reminder scheduler → Azure Communication Services (ACS) email
    │  proxies to ▼
Session container (FastAPI)             :8080   session-container/server.py + agent backend
    │  AGENT_BACKEND → agent.py (Copilot SDK)  |  agent_deepagents.py (Deep Agents)
    ├─ Azure OpenAI (gpt-4.1)
    ├─ Azure Cosmos DB   — app state (tasks/events/schedules/library), AAD-only
    ├─ Azure AI Search   — document retrieval (the Library)
    └─ per-session WORKSPACE folder — uploaded + agent-drafted documents
```

(**AG-UI** is the open agent-UI event protocol the agent emits; **SSE** is Server-Sent Events, the
transport; the **Foundry** resource is the Azure AI Foundry endpoint that hosts both Azure OpenAI and
Content Understanding, shared via `AZURE_ENDPOINT`.)

## Tiers

| Tier | Port | Stack | Responsibility |
|---|---|---|---|
| Frontend | 3000 | Next.js 16, React 19, Tailwind 4, TS strict | Split-screen UI; parses the SSE stream, renders the app pane from `/app/state` |
| Orchestrator (repo root) | 8000 | FastAPI (async) | Session CRUD, SSE proxy, auth forwarding, upload conversion, reminder scheduler |
| Session container | 8080 | FastAPI (async) | Runs the agent; exposes `/chat/stream`, `/upload`, `/files`, `/app/state`, `/session`, `/reset`, `/health` |

The orchestrator code **is the repo root** (there is no `orchestrator/` directory). The orchestrator
and session container are **two independent `uv` projects**, each with its own `pyproject.toml` +
`uv.lock`. Python is async throughout.

## Why the orchestrator never runs the SDK

Agent execution is isolated in the session container — in production, one container per user from an
ACA session pool (see [Production runtime](#production-runtime)). The orchestrator streams the
container's `/chat/stream` response to the browser line-by-line without reframing, so event
boundaries and multi-byte characters survive. This keeps the trust boundary at the orchestrator and
the heavier per-user agent runtime behind it.

## Anatomy of a turn

How "create a high-priority task" flows end to end — and why the agent can't lie about it:

```
1. Browser   POST /sessions/{id}/messages           the user's prompt
2. Orch  →   POST /chat/stream  (+ X-Cogservices-Token header)        proxied to the session container
3. Agent     model → tool call create_task → tool mutates the Cosmos document → model summarizes
4. Agent →   AG-UI SSE events stream out as they happen:
             RUN_STARTED → TOOL_CALL_START/ARGS/RESULT/END → TEXT_MESSAGE_* → RUN_FINISHED
5. Orch  →   passes the SSE stream through, unbuffered, to the browser
6. Frontend  reducer updates the chat; the app pane re-fetches GET /sessions/{id}/app/state and
             renders the new task from Cosmos — never from the tool arguments
```

Step 6 is the **verifiable-execution** invariant: the UI renders only from `/app/state` (the store
the tools mutate), so a claim can't outrun reality — if the tool didn't land the record, the pane
won't show it.

## SSE and AG-UI event flow

The session container speaks the AG-UI protocol (`ag_ui` package). Each event is a JSON-encoded
`BaseEvent` serialized as an SSE `data:` line. The agent backend's `send()` generator yields these
strings; the orchestrator passes them through; the frontend parses them into typed events
(`lib/sse.ts`) and drives a reducer (`hooks/useAgentSession.ts`).

| Event | Carries | Meaning |
|---|---|---|
| `RUN_STARTED` | `thread_id`, `run_id` | Turn begins |
| `TEXT_MESSAGE_START` / `_CONTENT` / `_END` | `message_id`, `delta` | Streamed assistant text |
| `TOOL_CALL_START` | `tool_call_id`, `tool_call_name` | Tool invocation begins |
| `TOOL_CALL_ARGS` | `tool_call_id`, `delta` | Tool arguments (JSON), shown in the trace |
| `TOOL_CALL_RESULT` | `tool_call_id`, `outcome`, `candidates?` | **Custom** — outcome `ok`/`noop`/`error` classified from the tool's status marker; nav candidates for chips |
| `TOOL_CALL_END` | `tool_call_id` | Tool invocation complete |
| `RUN_FINISHED` / `RUN_ERROR` | `run_id` / `message` | Turn complete / failed |

`TOOL_CALL_RESULT` is synthesized by both backends (not a raw SDK event) so the trace reflects what
actually happened — e.g. an ambiguous navigation shows as `noop` with candidate chips, never a false
success.

## State and storage

State is split by nature: **structured records** in a database, **documents** on the filesystem.

- **App state → Azure Cosmos DB.** A single document — `{ currentRoute, tasks[], events[], routes[],
  schedules[], library[] }` (the [data model](spec.md#data-model)) — keyed by a stable owner id
  (`COSMOS_OWNER_ID`, default `owner`), so it persists across sessions, tabs, and restarts
  (single-user POC). AAD-only (no key): tools authenticate with `DefaultAzureCredential` and mutate
  the document with an optimistic-ETag retry loop. The app pane renders only from `GET
  /sessions/{id}/app/state`, which reads this document.
- **Documents → per-session workspace folder.** Uploaded files and agent-drafted artifacts live
  under `<WORKSPACE>/<session_id>/`; a `.uploaded_files.json` manifest tracks user-uploaded vs
  agent-generated (the `origin` field in `/files`). Documents promoted to the **Library** are indexed
  in Azure AI Search for retrieval ([retrieval.md](retrieval.md)).

## Session lifecycle

- **IDs** are `uuid4().hex[:16]` (16 lowercase hex chars), validated by regex before any container probe.
- **Create** (`POST /sessions`) provisions the container workspace and records the id in the
  orchestrator's in-memory set; **validate** (`GET /sessions/{id}`) checks memory then probes the
  container (so a frontend can restore after an orchestrator restart); **delete** resets the workspace.
- **Concurrency:** the session container holds a per-session `asyncio.Lock` for the duration of a
  turn; a second `/chat/stream` while it's held returns **HTTP 409 "Session is busy"**.
- **No session database.** Live sessions are tracked in memory only; an orchestrator restart loses
  them and the frontend re-creates on next load. (App state in Cosmos is durable and unaffected.)

## Auth and trust model

- **Token forwarding.** The orchestrator fetches a Cognitive Services AAD token
  (`DefaultAzureCredential`, scope `https://cognitiveservices.azure.com/.default`) and forwards it to
  the session container on each `/chat/stream` call via the **`X-Cogservices-Token`** header; the
  agent uses it as the Azure OpenAI bearer token. Locally it falls back to `AZURE_OPENAI_TOKEN` or
  the container's own `DefaultAzureCredential`.
- **AAD-only data planes** for Cosmos, ACS, and Azure OpenAI (managed identity / forwarded token, no
  keys). **Exception:** Azure AI Search uses an **admin key** (`AZURE_SEARCH_KEY`), not AAD.
- **Trust boundary** is the orchestrator: caller authentication (IP allow-list and/or Entra app
  registrations — see [deployment.md](deployment.md#auth)) is enforced there; the per-user session
  container sits behind it.
- **Single-owner caveat.** This POC keys app state to one `COSMOS_OWNER_ID`, so all sessions read and
  write the **same** Cosmos document — there is no per-session data isolation for app state (only the
  document *workspace* is per-session). Multi-user isolation would key the document by the signed-in
  user's id.

## Scheduled reminders

The orchestrator runs an always-on scheduler loop (`scheduler.py`, `SCHEDULER_TICK_SECONDS` default
60) that executes due `schedules[]` entries: each is a saved natural-language prompt run through the
agent, emailed to `REMINDER_EMAIL` via Azure Communication Services (AAD-only). It is a no-op until a
reminder exists and comes due.

## Production runtime

Each user gets an **isolated session container** from an Azure Container Apps custom-container
**session pool** (`infra/deploy.sh`); the orchestrator and frontend are Container Apps. (The
microVM-isolated ACA *Sandboxes* primitive is the forward-looking target; the current deploy uses the
session pool.) Durable stores are Cosmos (app state), Azure AI Search (the Library index), and ADLS
(upload originals); the per-session container working set is ephemeral.

## Limitations and known gaps

Durable caveats a reader should know (the dated [POC findings](../review/2026-06-24-deepagents-poc/FINDINGS.md)
carry the rest):

- **No app-state isolation** between sessions in the POC — all share one owner-keyed Cosmos document.
- **Sessions are in-memory** on the orchestrator; a restart drops the live set (Cosmos state survives).
- **Harness parity gap:** the Deep Agents backend implements the 14 core tools, not Schedules/Library,
  and its negative paths (cancellation, ambiguous/garbage input) are not yet stress-tested.
- **Tool logic is duplicated** per harness today; the shared **MCP** tool substrate is not built.
- **Search auth is key-based**, not AAD (above).

## Key design decisions

- **Orchestrator is a pure proxy** — agent execution never runs in it.
- **Verifiable execution** — the UI renders only from `/app/state`; tools mutate that exact store.
- **AAD-only data planes** (except Search) — managed identity / forwarded tokens.
- **Harness behind a seam** — a single `AgentSession` contract makes the agent SDK swappable
  ([harnesses.md](harnesses.md)).
