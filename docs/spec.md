# Personal Assistant — Product & Design Spec

Personal Assistant is the demo application for the agent-harness accelerator: an AI assistant embedded *inside*
a real web app that operates the app through tools, rather than chatting beside it. The harness is
the product; Personal Assistant — a small personal-productivity app — is deliberately simple dressing chosen
because it maps cleanly onto the four capabilities the accelerator exists to demonstrate.

For the system architecture see [architecture.md](architecture.md); for the two agent harnesses see
[harnesses.md](harnesses.md).

## The four capabilities

1. **Navigation** — the agent moves the user around the app ("take me to my calendar", "open the
   project brief"). Resolution is deterministic: resolved / ambiguous (→ candidate chips) /
   not-found (→ honest refusal, no wrong nav).
2. **CRUD** — the agent creates, reads, updates, and deletes real records (tasks, calendar events)
   that persist in app state and survive a refetch.
3. **RAG** — the agent does semantic retrieval over a document library and answers with grounded,
   cited passages, or fails loud when retrieval is unavailable. See [retrieval.md](retrieval.md).
4. **Document ops** — the agent drafts and edits markdown documents in an artifact canvas.

A cross-cutting invariant ties them together — **verifiable execution**: the app pane renders
*only* from `GET /sessions/{id}/app/state`, and the agent's tools mutate that same store, so the
assistant can only claim work a tool actually performed.

## Surfaces

The app has six navigation destinations. The assistant is always present as a docked co-pilot on
the five host surfaces, and full-screen as the AI Workbench.

| Nav label | Route | Shows |
|---|---|---|
| Home | `/home` | Today's agenda: what's due, overdue count, next events, quick stats |
| To-Do | `/todo` | Tasks grouped by bucket, with status pills + priority |
| Calendar | `/calendar` | Agenda-by-day view merging events with task due-dates |
| Documents | `/documents` | Document library (seeded + uploaded) and AI-generated drafts |
| Reminders | `/reminders` | Scheduled reminders — recurring prompts run on a cadence and emailed |
| AI Workbench | `/assistant` | The full-screen assistant workspace (chat spine + artifact canvas) |

The five host surfaces are in the app-state `routes[]` (so the agent can `navigate` to them);
`/assistant` is a frontend-only route and is intentionally not a navigable destination.

## Data model

Application state is a single document — `{ currentRoute, tasks[], events[], routes[], schedules[],
library[] }` — stored in Azure Cosmos DB and keyed by a stable owner id (`COSMOS_OWNER_ID`, default
`owner`), so it persists across sessions, tabs, and restarts (single-user POC; see
[architecture.md](architecture.md#state-and-storage)). The agent's tools mutate it; the app pane
renders from it. A fresh workspace seeds only the document Library; tasks, events, and schedules
start empty (the example below shows the *shape*, not seed data). `routes[]` is the lookup table the
deterministic `navigate` resolver matches against.

```jsonc
{
  "currentRoute": "/home",
  "tasks": [
    {
      "id": "t-1",
      "title": "Draft Q3 planning doc",
      "status": "In progress",     // To do | In progress | Blocked | Done
      "priority": "High",          // Low | Medium | High
      "group": "Work",             // free-form bucket (Work, Personal, …)
      "dueDate": "2026-06-25",     // YYYY-MM-DD, optional
      "subtasks": [ { "text": "outline", "done": true } ],
      "notes": "",
      "createdAt": "2026-06-20T…"
    }
  ],
  "events": [
    {
      "id": "e-1",
      "title": "Team standup",
      "date": "2026-06-24",
      "start": "10:00",            // 24h HH:MM, optional
      "end": "10:30",              // optional
      "type": "Meeting",           // Meeting | Reminder | Focus | …
      "notes": ""
    }
  ],
  "routes": [ { "path": "/home", "title": "Home", "keywords": ["home", "today", "overview"] } ],
  "schedules": [
    {
      "id": "s-1",
      "title": "Daily agenda email",
      "prompt": "Summarize my agenda and anything due in the next 3 days",
      "cadence": "daily"          // run on a cadence; the output is emailed to the user
    }
  ],
  "library": [
    { "filename": "Q2-Budget-Overview.md", "title": "Q2 Budget Overview", "source": "library" }
  ]
}
```

Beyond the two CRUD entities, the model carries two more subsystems:

- **`schedules`** — recurring reminders. Each is a saved natural-language prompt the orchestrator
  runs on a cadence; the result is emailed to the user (via Azure Communication Services).
- **`library`** — a persistent, indexed document library that backs retrieval. Session files are
  ephemeral and read directly; a file promoted to the Library is chunked and indexed in Azure AI
  Search so `search_documents` can retrieve it across sessions. See [retrieval.md](retrieval.md).

Two distinct entities — `tasks` and `events` — so "schedule a 3pm meeting tomorrow" is a genuinely
different CRUD demo from "add a task," and the Calendar has real content to merge with task
deadlines. Storage helpers live in [`session-container/appdb.py`](../session-container/appdb.py):
atomic save, fail-loud load, `new_id()`, route resolution, and an `is_overdue()` the tools use so
the model never judges dates itself.

## Agent tools

Defined per harness in its SDK dialect ([Copilot](../session-container/agent.py) /
[Deep Agents](../session-container/agent_deepagents.py)) over the same logic. Every tool returns a
leading status marker so its outcome (ok / noop / error) classifies honestly in the trace.

| Tool | Purpose |
|---|---|
| `navigate(destination)` | Deterministic route/entity resolver → resolved / ambiguous / not-found |
| `list_tasks()` | Review tasks with status, priority, group, due date, computed `overdue`, subtask progress |
| `create_task(title, status?, priority?, group?, due_date?)` | Add a task |
| `update_task(task, status?, priority?, group?, due_date?)` | Modify a task |
| `delete_task(task)` | Remove a task |
| `add_subtask(task, text)` | Append a subtask |
| `list_events()` | Review calendar events |
| `create_event(title, date, start?, end?, type?)` | Schedule an event (date required) |
| `update_event(event, …)` | Move or change an event |
| `delete_event(event)` | Remove an event |
| `list_documents()` | Discover workspace documents before reading |
| `read_workspace_file(path?)` | Read a UTF-8 text/markdown document |
| `write_file(path, content)` | Draft/edit a markdown artifact (appears in Documents + canvas) |
| `search_documents(query)` | Semantic search over the indexed Library → cited passages |
| `save_to_library(filename)` | Promote a session file into the persistent, indexed Library |
| `list_library()` | List the documents currently in the Library |
| `create_schedule(title, prompt, …)` | Save a recurring reminder run on a cadence and emailed |
| `list_schedules()` | Review scheduled reminders |
| `delete_schedule(schedule)` | Remove a scheduled reminder |

The Copilot harness implements the full set above. The Deep Agents harness currently implements the
14 core navigation/CRUD/document/search tools; the Schedules and Library tools are a known parity
gap (see [harnesses.md](harnesses.md)).

## Skills

Markdown skills in [`session-container/skills/`](../session-container/skills/), in the SDK
`{name}/SKILL.md` format with `name` + `description` frontmatter:

- **`tasks`** — create/update/delete/review tasks and subtasks; use the `overdue` flag, never judge dates.
- **`calendar`** — create/move/delete events; agenda reasoning against the "[Today: …]" context.
- **`documents`** — discover → read → answer strictly from what was read; draft as markdown artifacts.
- **`research`** — when to call `search_documents`, how to ground answers in retrieved passages and cite sources, and to fail loud rather than fabricate.

## Visual design

A light, Monday.com-style theme defined in `frontend/src/app/globals.css` (the source of truth for
the exact tokens): a white canvas, dark text, a blue primary action and a purple AI accent, and
status pills — Done green, In-progress orange, Blocked/overdue red, To-do gray. The UI is a
responsive two-surface layout: the host app with a docked co-pilot, collapsing to a focused
assistant view on narrow viewports.

## Non-goals

- No real auth, no multi-user — a per-session sandbox only.
- Synthetic-but-realistic seed data only; no real personal or client data in the repo.
- No new architectural abstractions for the demo skin — reskin within the existing harness.
