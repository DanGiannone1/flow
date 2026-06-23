# Tax Workbench — Next-Gen Agent Architecture POC

A proof-of-concept showing that a **single sandboxed GitHub Copilot SDK agent + tools/skills +
AG-UI streaming + per-user sandboxes** is a viable next-gen architecture for an in-app tax
assistant — replacing a traditional multi-step planner/orchestrator multi-agent design where a
simple "navigate me there" request fans out to ~8 model calls across multiple agent layers.

Here, the agent reads the request and calls **one tool** directly. Every action mutates the real
application state the UI renders, so the assistant can only claim work it actually did.

See [`POC-SUCCESS-CRITERIA.md`](./POC-SUCCESS-CRITERIA.md) for the full scope and acceptance bar.

## What it is

- **Tax Workbench** — a mock tax practice app (Clients → Engagements → Work Areas → work-plan tasks,
  engagement-letter templates, information requests, documents).
- **Tax Assistant** — an embedded agent that navigates the app and acts on its data through tools.
- Split-screen UI: chat (left) + the live app (right). Agent actions visibly change the app.

## Architecture

```
Frontend (Next.js 16)            :3000
  └─ HTTP + SSE → Orchestrator (FastAPI)        :8000   [SSE proxy + auth forwarding; never runs the SDK]
       └─ SSE proxy → Session Container (FastAPI):8080   [GitHub Copilot SDK 1.0.x + tax tools + skills]
            ├─ Azure OpenAI (gpt-4.1)
            └─ per-session WORKSPACE FOLDER  (app state JSON + uploaded/generated files)
```

- **State + files** live in a per-session workspace folder (no database). The agent's tools mutate
  `.taxdb.json`; the app pane renders only from `GET /sessions/{id}/app/state`.
- **Tools** (`session-container/agent.py`): `navigate`, `list/create/update_task`,
  `list/get/get_latest_template`, `list/create_information_requests`, `read_workspace_file`,
  `write_file`. **Skills** (`session-container/skills/`): navigation, task-management,
  information-requests, documents.
- **Uploads** (incl. PDF/DOCX) convert via Azure Content Understanding + ADLS
  (`content_processing.py`).
- Targets **Azure Container Apps dynamic sessions** long-term (ephemeral per-user sandboxes);
  durable external state is deferred.

## Run locally

```bash
cp .env.example .env   # fill Azure OpenAI + (optional) Content Understanding values
az login               # session container gets its Azure OpenAI token via DefaultAzureCredential
python dev.py          # starts session container :8080, orchestrator :8000, frontend :3000
```

Open http://localhost:3000.

## End-to-end test

```bash
node scripts/poc_e2e.mjs   # drives the real frontend through all scenarios, writes screenshots/poc/
```

## Key files

| Tier | Files |
|---|---|
| Orchestrator | `app.py`, `session_manager.py`, `content_processing.py` |
| Session container | `session-container/server.py`, `agent.py`, `taxdb.py`, `skills/` |
| Frontend | `frontend/src/components/Chat.tsx`, `components/workbench/WorkbenchApp.tsx`, `hooks/useAgentSession.ts` |
