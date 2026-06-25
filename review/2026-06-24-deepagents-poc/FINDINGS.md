# Deep Agents POC — Findings & Comparison vs the GitHub Copilot SDK

**Date:** 2026-06-24
**Goal:** Stand up a standalone LangGraph **Deep Agents SDK** version of the Flow runtime
agent that does the same things as the shipped GitHub Copilot SDK (GHCP) agent, prove it
out against the real frontend, and consolidate findings.

**Outcome: PROVEN.** A second agent backend (`agent_deepagents.py`) runs the full Flow app —
navigation, task CRUD, event CRUD, document drafting, and grounded RAG — through the *same*
orchestrator, frontend, and `/app/state` store as the Copilot agent. Driven through the real
browser as a user, **both backends pass all 15 checks identically, with zero page errors.**

---

## 1. What was built

| File | Change |
|---|---|
| `session-container/agent_deepagents.py` | **New.** Standalone `AgentSession` running `deepagents.create_deep_agent` against Azure OpenAI. Interface-identical to `agent.AgentSession`. |
| `session-container/server.py` | **2-line switch.** `AGENT_BACKEND=deepagents` selects the new backend; default `copilot` unchanged. |
| `session-container/pyproject.toml` | Added `deepagents>=0.6.11`, `langchain-openai>=1.3.3`. |
| `scripts/deepagents_poc.mjs` | **New.** Playwright journey: walks all 4 capabilities + verifiable-execution, screenshots each step, reconciles UI vs `/app/state`. |

`agent.py` (the Copilot backend) was **not modified** — the two backends never couple.

### How to run
```bash
# Deep Agents backend
AGENT_BACKEND=deepagents uv run dev.py
# Copilot backend (default / shipped)
uv run dev.py
# Same journey against whichever is running:
node scripts/deepagents_poc.mjs   # → screenshots/deepagents-poc/
```

---

## 2. The seam (why this was a contained swap)

The Copilot SDK is hidden behind one class. `server.py` consumes it through a narrow contract:

- `AgentSession(working_dir, token=, session_id=)`, `__aenter__`/`__aexit__`
- `.token` (server re-inits on token change) and `.raw_sdk_log_path` properties
- `async for sse_str in session.send(prompt)` → yields **already-formatted AG-UI SSE strings**

The deep-agent backend re-implements exactly that contract. Everything above it — the
orchestrator SSE proxy, the frontend AG-UI reducer, `/app/state` (Azure Cosmos) — is byte-for-byte
unchanged. The whole port is "emit the same AG-UI event stream from a different agent runtime."

AG-UI sequence reproduced: `RunStarted` → `TextMessageStart/Content/End` (token stream) →
per tool `ToolCallStart` + `ToolCallArgs` + custom `TOOL_CALL_RESULT{outcome, candidates?}` +
`ToolCallEnd` → `RunFinished`/`RunError`.

---

## 3. deepagents API — verified against installed source (v0.6.11), not docs

| Question | Finding |
|---|---|
| Does the "deep" harness force planning / block quick actions? | **No.** `write_todos` (planning), the scratch FS, subagents (`task`), and `execute` are just *tools on the menu*. Hidden from the model, the agent does one direct tool call per turn — same as GHCP. |
| How to hide built-ins? | `tools=` is **additive** (never removes a built-in). Hiding is done with `_ToolExclusionMiddleware(excluded={...})` passed via `middleware=` — it strips tools by name from the model request. `FilesystemMiddleware`/`SubAgentMiddleware` are *protected* (can't drop the middleware), but stripping their model-visible tools is enough. |
| `write_file` name collision (ours vs built-in)? | **Resolved.** Verified empirically: a user `tools=` entry **wins** the name dedupe. Our `write_file` executes; the built-in is shadowed. Frontend keys on exact tool+arg names, so names are preserved. |
| Skills | deepagents has a **native `SkillsMiddleware`** using the *same* `SKILL.md`+frontmatter format Flow already uses (progressive disclosure). The POC **inlines** the 4 skills into the system prompt instead (simpler; see §6). |
| Model / auth | `AzureChatOpenAI(azure_endpoint=<base>, azure_deployment, api_version, azure_ad_token=<forwarded Cognitive-Services token>)`. AAD-only, mirroring the Copilot backend. |
| Streaming | `agent.astream_events(..., version="v2")` → `on_chat_model_stream` (text), `on_tool_start`/`on_tool_end` (tools). Natively async — **no background thread/queue** (the Copilot path needs one). |

**Endpoint gotcha (cost me one iteration):** `.env` `AZURE_ENDPOINT` ends in `/openai`. My first
attempt used `ChatOpenAI(base_url=AZURE_ENDPOINT)` → POSTed to `…/openai/chat/completions` → **404
on every turn** (surfaced loudly as the agent's reply, not silently). Fix: `AzureChatOpenAI` with
the base resource (`…/openai` stripped) + the classic deployments path (verified 200).

---

## 4. Test results — A/B, real browser, reconciled to `/app/state`

Same `scripts/deepagents_poc.mjs`, run against each backend. **15/15 PASS on both.**

| Capability | Check | Deep Agents | Copilot |
|---|---|:--:|:--:|
| Boot | session created | ✅ | ✅ |
| **Navigation** | "take me to my calendar" → `currentRoute=/calendar`, single tool step | ✅ | ✅ |
| **Task CRUD** | create High-priority task, Work group, due 2026-06-26 → in `/app/state` + rendered row | ✅ | ✅ |
| | "mark in progress" → status updated in state | ✅ | ✅ |
| **Event CRUD** | "3pm meeting tomorrow" → event `15:00`/`2026-06-25` in state + on Calendar | ✅ | ✅ |
| **Document ops** | "draft kickoff doc" → `kickoff.md` in workspace + rendered in artifact canvas | ✅ | ✅ |
| **RAG** | "budget decision in my notes?" → grounded answer citing source `.md` | ✅ (cited `One-on-One-Notes.md`, `Q2-Budget-Overview.md`) | ✅ |
| **Verifiable exec** | every UI assertion cross-checked against `/app/state` dump | ✅ | ✅ |
| Hygiene | 0 page errors | ✅ | ✅ |

Screenshots: `screenshots/poc-deepagents/` and `screenshots/poc-copilot/` (8 each, examined).
State dumps: `screenshots/poc-deepagents/state-*.json`.

### Trace reconciliation (per the localhost-ui-validation skill)
- **Browser** showed the right pane mutate after each turn (task row, calendar event, artifact).
- **`logs/trace.jsonl`**: both backends emitted the **same 6 tool calls in the same order** —
  `navigate, create_task, update_task, create_event, write_file, search_documents`, each `outcome=ok`,
  **exactly one tool call per turn**. Deep Agents: **zero** `write_todos`/subagent leakage.
- **`logs/sdk-events/<id>.jsonl`**: Deep Agents = `on_chat_model_stream`/`on_tool_start`/`on_tool_end`;
  Copilot = `AssistantStreamingDeltaData`/`ToolExecutionStartData`/… — different raw shapes, **identical
  AG-UI output** downstream.

---

## 5. Deep Agents vs GitHub Copilot SDK — comparison

| Dimension | GitHub Copilot SDK | LangGraph Deep Agents |
|---|---|---|
| **Tool definition** | `@define_tool` + Pydantic param model | LangChain `@tool` (type-hinted args) |
| **Tool surface control** | You list `available_tools`; clean allowlist | Built-ins are **additive**; you must *exclude* via middleware |
| **Skills** | First-class: `enable_skills` + `skill_directories`, progressive disclosure, surfaced as a "skill" trace step | First-class **`SkillsMiddleware`** (same SKILL.md format) — but POC inlined into prompt; "skill" trace step not reproduced |
| **Planning/sub-agents/FS** | None by default (matches Flow's "one direct action") | Present by default; **must be switched off** to match Flow |
| **Streaming** | Event callback on a worker thread → asyncio queue (`call_soon_threadsafe`) | Native async `astream_events` — simpler, no thread/queue |
| **Model/auth** | `provider` dict, bearer token, `wire_api=completions` against the `/openai/v1/` path | `AzureChatOpenAI`, `azure_ad_token`, classic deployments path |
| **Multi-turn memory** | SDK session holds context | LangGraph `InMemorySaver` checkpointer + `thread_id` |
| **Lines of code** | ~1000 (`agent.py`) | ~640 (`agent_deepagents.py`), incl. ported tool logic |
| **Behavior in this app** | one direct tool call/turn | **identical** — one direct tool call/turn |
| **Ecosystem** | GitHub/Copilot-specific | Broad LangChain ecosystem (models, middleware, tracing) |

**Net:** For Flow's "operate the app, don't over-plan" thesis, the two are behaviorally
equivalent. Copilot is leaner *for this shape* (no built-ins to suppress) and gives skills +
a skill trace step for free. Deep Agents trades that for a simpler async streaming model, a
much larger ecosystem, and built-in planning/subagent/FS machinery that Flow deliberately
turns off but a more agentic product could turn on.

---

## 6. Limitations / parity gaps (honest residual)

- **Skills inlined, not native.** The POC concatenates the 4 `SKILL.md` bodies into the system
  prompt rather than using `SkillsMiddleware`. Consequence: no per-skill "Loading skill" step in
  the trace (the Copilot run shows one `SessionSkillsLoadedData`). Native skills are the
  production path; wiring `skills=[…]` needs a backend whose `read_file` can reach the skills dir.
- **Tool logic is duplicated** (~250 lines) between `agent.py` and `agent_deepagents.py`, per the
  "standalone module" decision. A shared-core refactor would remove the duplication but touches the
  shipped Copilot file. Drift risk is real; flagged.
- **Cancellation/abort** relies on the `send()` async-generator being closed (GeneratorExit cancels
  the `astream`). Not stress-tested under mid-stream Stop / rapid New-Chat the way the Copilot
  `session.abort()` path is. Should be exercised before production.
- **Static AAD token per session** (mirrors Copilot). Fine for short sessions; a long session past
  token expiry would need `azure_ad_token_provider` refresh.
- **Not tested:** upload→summarize, ambiguous/not-found nav chips, corrupt-state fail-loud,
  responsive/narrow viewport. Core capabilities only.
- **Uncommitted.** New files + deps are on the working tree, not committed.

---

## 7. Recommendation

The Deep Agents backend is a viable, behaviorally-equivalent alternative for Flow and a clean
demonstration that the harness layer is swappable behind the AG-UI seam. If pursued beyond POC:
(1) switch skills to native `SkillsMiddleware` to restore the skill trace step, (2) decide
standalone-vs-shared-core for the tool logic, (3) harden cancellation, (4) exercise the negative
paths in §6.
