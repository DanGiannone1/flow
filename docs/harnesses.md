# Agent Harnesses

Flow runs the same application on **two interchangeable agent harnesses**. Proving that the
agent runtime is swappable — without touching the orchestrator, the frontend, or the app-state
store — is a primary goal of the project.

| `AGENT_BACKEND` | Harness | Module | Status |
|---|---|---|---|
| `copilot` (default) | GitHub Copilot SDK (`github-copilot-sdk`) | [`session-container/agent.py`](../session-container/agent.py) | Shipped |
| `deepagents` | LangGraph **Deep Agents** (`deepagents`) | [`session-container/agent_deepagents.py`](../session-container/agent_deepagents.py) | Working |

Both pass the same end-to-end journeys against the real frontend. See the comparison and test
evidence in [`review/2026-06-24-deepagents-poc/FINDINGS.md`](../review/2026-06-24-deepagents-poc/FINDINGS.md).

## The seam: `AgentSession`

The **seam** — the single contract that isolates the agent SDK so it can be swapped — is one class.
[`server.py`](../session-container/server.py) selects the implementation at import time by
`AGENT_BACKEND` and consumes it through this narrow contract; nothing else in the stack knows which
harness is running:

```python
class AgentSession:
    def __init__(self, working_dir: str, token: str | None = None, session_id: str = "default"): ...
    async def __aenter__(self) -> "AgentSession": ...
    async def __aexit__(self, *exc) -> None: ...

    token: str | None            # server re-inits the session if the forwarded token changes
    raw_sdk_log_path: str | None  # optional raw event log for trace reconciliation

    async def send(self, prompt: str) -> AsyncGenerator[str, None]:
        """Yield already-formatted AG-UI SSE strings until the turn completes."""
```

Because `send()` yields the **same AG-UI event stream** regardless of backend (see
[architecture.md](architecture.md#sse-and-ag-ui-event-flow)), the orchestrator proxy, the frontend
reducer, and the Cosmos-backed `/app/state` store are byte-for-byte unchanged between harnesses.
Porting a harness is "emit the same event stream from a different agent runtime."

The event sequence both backends produce per turn:

```
RUN_STARTED
  TEXT_MESSAGE_START → TEXT_MESSAGE_CONTENT* → TEXT_MESSAGE_END   (streamed assistant text)
  per tool call:  TOOL_CALL_START → TOOL_CALL_ARGS
                  → TOOL_CALL_RESULT{outcome: ok|noop|error, candidates?}   (custom)
                  → TOOL_CALL_END
RUN_FINISHED        (or RUN_ERROR on failure/timeout)
```

`TOOL_CALL_RESULT` is a custom AG-UI-shaped event carrying the outcome classification (derived
from each tool's leading status marker — `NAVIGATED`/`CREATED`/`AMBIGUOUS`/`*_NOT_FOUND`/…) so the
trace pane reflects what actually happened, including ambiguous-navigation candidate chips.

## How the two harnesses differ

| Aspect | Copilot SDK | Deep Agents |
|---|---|---|
| Tool definition | `@define_tool` + Pydantic param model | LangChain `@tool` (type-hinted args) |
| Built-in tools | none by default | planning (`write_todos`), scratch filesystem, subagents (`task`), shell — **all hidden** via `_ToolExclusionMiddleware` so behaviour matches the one-direct-action app |
| Skills | native (`enable_skills`, `skill_directories`), surfaced as a "skill" trace step | inlined into the system prompt for the POC (native `SkillsMiddleware` is the production path) |
| Streaming | SDK event callback on a worker thread → `asyncio.Queue` | native async `astream_events` (no thread/queue) |
| Model / auth | `provider` dict + bearer token | `AzureChatOpenAI(azure_ad_token=…)` |
| Multi-turn memory | SDK session | LangGraph `InMemorySaver` checkpointer keyed by `thread_id` |

For Flow's "operate the app, one direct tool call per turn, don't over-plan" design, the two are
behaviourally equivalent across the core capabilities — verified by an A/B run where both emitted
the identical six tool calls in the same order with zero planning leakage.

**Current parity gap:** the Deep Agents harness implements the 14 core navigation / CRUD / document
/ search tools. The Copilot harness additionally ships the **Schedules** (recurring emailed
reminders) and **Library** (`save_to_library` / `list_library`) tools. Closing this gap — and the
move to a shared MCP tool substrate below — is tracked work toward "both harnesses always working"
at full parity.

## The reusable substrate (direction — not yet built)

The harnesses currently each define the Flow tools in their own SDK dialect, and the markdown
skills are shared files that the Copilot harness loads natively while the Deep Agents harness
inlines. The intended end state makes the **tools and skills a reusable substrate** that every
harness taps into:

- **Tools** → a **Flow MCP server** (MCP = Model Context Protocol; the tool logic — navigate,
  task/event CRUD, document ops, search — lifted out of the harnesses). Each harness connects as an
  MCP client: the Copilot SDK exposes an `mcp_servers=` parameter, and Deep Agents consumes MCP tools
  via the `langchain-mcp-adapters` package — both support this today.
- **Skills** → one `skills/*/SKILL.md` directory, loaded by both harnesses (Copilot natively;
  Deep Agents via `SkillsMiddleware`, which speaks the identical SKILL.md format).

The open design question is **per-session context**: Flow tools mutate a specific session's
workspace and Cosmos document, so the MCP server must be bound to one session (recommended:
a stdio MCP server launched per `AgentSession` with the workspace bound via env) rather than
letting the model pass a session id.

## Adding a third harness

1. Implement `AgentSession` with the contract above in a new `agent_<name>.py`.
2. Translate the SDK's streaming events into the AG-UI sequence shown above.
3. Register it in [`server.py`](../session-container/server.py)'s `AGENT_BACKEND` switch.
4. Validate with the end-to-end journey (see [development.md](development.md#testing)); both the
   existing and new harness must stay green.
