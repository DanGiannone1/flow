---
name: architecture:sse-flow
description: SSE event flow and AG-UI protocol for the RFP Agent — how events travel from the Copilot SDK to the frontend.
---

# SSE Event Flow

## Protocol: AG-UI

The session container uses the **AG-UI open protocol** (Python package: `ag_ui`). All SSE events are JSON-encoded `BaseEvent` subclasses serialized with `model_dump_json(exclude_none=True)`.

## Event Types

| AG-UI Type | Trigger |
|---|---|
| `RUN_STARTED` | Start of every agent turn; carries `thread_id` + `run_id` |
| `TEXT_MESSAGE_START` | First text delta from the assistant; carries `message_id` + `role` |
| `TEXT_MESSAGE_CONTENT` | Each streaming text delta; carries `message_id` + `delta` |
| `TEXT_MESSAGE_END` | Assistant message complete; carries `message_id` |
| `TOOL_CALL_START` | Tool invocation begins; carries `tool_call_id`, `tool_call_name`, `parent_message_id` |
| `TOOL_CALL_ARGS` | Tool arguments (forwarded so frontend can show context); carries `tool_call_id` + `delta` |
| `TOOL_CALL_END` | Tool invocation complete; carries `tool_call_id` |
| `RUN_FINISHED` | Agent turn complete (SESSION_IDLE); carries `thread_id` + `run_id` |
| `RUN_ERROR` | Agent error or timeout; carries `message` |

Internal Copilot SDK tools (e.g. `report_intent`) are suppressed — no `TOOL_CALL_START`/`END` emitted for them.

## Pipeline: SDK → Frontend

```
CopilotClient (SDK internal thread)
    │  SessionEventType events (ASSISTANT_MESSAGE_DELTA, TOOL_EXECUTION_START, etc.)
    ▼
AgentSession._on_event()        [agent.py]
    │  Translates to AG-UI events, thread-safe enqueue
    ▼
asyncio.Queue[BaseEvent | None]  [None = sentinel / end of turn]
    │
AgentSession.send() generator   [yields SSE-formatted strings]
    │  "data: {...}\n\n"
    ▼
session-container /chat/stream  [server.py — holds _lock during turn]
    │  asyncio.timeout(CHAT_TIMEOUT_SECONDS, default 300s)
    ▼
SessionManager.send_message()   [session_manager.py — proxies line-by-line]
    │  httpx streaming POST, yields raw SSE lines
    ▼
Orchestrator /sessions/{id}/messages  [app.py — StreamingResponse]
    │
    ▼
Frontend streamSSE()            [lib/sse.ts — parses SSE lines]
    │  AGUIEvent objects
    ▼
Chat.tsx useReducer             [components/Chat.tsx]
    │  Dispatches: RUN_STARTED → ASSISTANT_START → DELTA* → MESSAGE_END → TOOL_START/END* → DONE/ERROR
```

## Session Container Concurrency

The session container holds an `asyncio.Lock` (`_lock`) for the duration of each agent turn. A concurrent request while the lock is held **blocks** until the lock is released — the session container does not return HTTP 409. The orchestrator (`session_manager.py`) contains a defensive 409 check that would emit a `RUN_ERROR` ("Session is busy") event, but the session container never actually emits that status code.

## Error & Timeout Handling

- **Timeout:** `asyncio.timeout(chat_timeout)` in `server.py`. On expiry, the `AgentSession` singleton is destroyed and a `RUN_ERROR` + `RUN_FINISHED` pair is emitted so the frontend reaches a terminal state.
- **Rate limit detection:** `AgentSession._on_event` inspects the error message for "429", "too many requests", "rate limit", "capierror" and replaces with a user-friendly message.
- **Unhandled exception:** Session is destroyed, generic retry message emitted.
