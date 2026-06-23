# Tax Assistant — Next-Gen Agent Architecture POC — Success Criteria

**Goal:** Demonstrate that a single sandboxed GitHub Copilot SDK agent + tools/skills + AG-UI
streaming + per-user sandboxes is a viable next-gen architecture for an in-app tax assistant —
replacing a traditional multi-step planner/orchestrator multi-agent design (LangGraph-style) where a
simple "navigate me there" request can fan out to ~8 model calls / ~12s across multiple agent layers
before anything happens. In this POC, the agent reads the request and calls one tool directly.

**Starting point:** the proven `tax-agent` repo (per-user session container running the Copilot SDK,
AG-UI/SSE streaming through an orchestrator proxy, Next.js frontend), reskinned to a generic tax
practice domain.

**Product naming (generic, no third-party branding):** the mock application is **"Tax Workbench"**;
the assistant is **"Tax Assistant."**

---

## A. Functional — the 4 scenarios must work end-to-end

Validated via Playwright against the real frontend (per CLAUDE.md): drive chat as a user, assert on
rendered state, screenshot each step.

**1. Navigation / wayfinding**
- "Take me to Federal Compliance" → right pane routes to the Federal Compliance work area, showing its
  work-plan tasks.
- Ambiguous input ("go to compliance" → matches Federal + State & Local) → agent returns the candidate
  list and asks which; picking one navigates. Disambiguation uses **one** `navigate` call, not a
  multi-step LLM routing chain.
- Unknown destination → agent says it can't find it and lists closest options (fail-loud; no silent
  wrong navigation).

**2. Entity / CRUD — work-plan task**
- "Create a Q3 estimated payment task in Federal Compliance, due Sept 15, assigned to me" → a new task
  row appears in the Federal Compliance work plan with correct title/type/due/assignee, and the app
  navigates there. State survives a refetch (it lives in the workspace state, not just chat).
- "Mark the book-tax reconciliation task in progress" → that task's status visibly updates.

**3. Document ops**
- "Show me the latest engagement letter template" → agent resolves to the most-recently-updated
  Engagement Letter template (v3.2, not the older v2.8 / international), the Templates screen opens to
  it, and its content is shown. Must pick *latest* correctly, not just any match.
- Upload a tax document (incl. PDF) → "summarize this" → agent reads the converted source and returns a
  grounded summary; the upload + any generated artifact appear in the Documents area.

**4. Bulk import — information requests**
- Pasting a multi-row request block → agent parses the rows and creates all of them in **one**
  `create_information_requests` call; all appear as rows in the Information Requests work area with
  correct title / responsible party / content. New-row count = pasted-row count.

**5. General helpfulness (NOT scripted — the real bar)**
- The agent handles a **wide variety** of in-domain asks it wasn't hand-tuned for, composing existing
  tools and adjusting on the fly — e.g. "what's overdue in Federal Compliance?", "move the 1120 task to
  next week", "which engagement letters are out of date?". Reasonable asks get a useful, grounded
  response or a sensible clarifying question — it does not fall over outside the four scripts. This is
  judged by the subagent review panel (Section I), not a single fixed assertion.

**6. Conversation continuity**
- The session remembers context across turns: "create a task" → "actually, mark it in progress" resolves
  "it" to the task just created, with no need to re-specify.

---

## B. Architecture & execution visibility

- **Faithful architecture:** per-user sandbox (session container), AG-UI/SSE streaming through the
  orchestrator proxy, no new event type for navigation (reuses tool-call events). Orchestrator never
  runs the SDK.
- **User-facing trace is the priority (Claude-style).** As the agent works a multi-step request, the
  **chat** streams clean, human-readable step indicators — the way Claude shows its tool calls during a
  multi-step turn: each step names what's happening ("Navigating to Federal Compliance", "Creating task
  'Q3 Estimated Payment'", "Reading engagement-letter.pdf"), shows a working/done state, and reads as a
  natural part of the conversation. This must look polished — it's a primary UX surface, not debug
  output. (Exact styling is our judgment; the bar is "looks as good as Claude's tool-call UI.")
- **Detailed/raw trace = optional, our discretion.** A deeper panel (raw args/results, timings, step
  counts) MAY be added if it's cheap and clean, but it is not a hard requirement. The fueling logs
  (`trace.jsonl` / `sdk-events`) exist regardless.
- **Demonstrable contrast:** a navigation that costs a traditional planner/orchestrator multi-agent
  baseline ~8 model calls / ~12s is visibly a single tool call in one agent loop here — evident from the
  user-facing step trace, no fabricated baseline number shown in-UI.
- **Skills are real:** the agent loads a matching tax skill when relevant (navigation, task-management,
  information-requests, documents); skill use is reflected in the trace.

---

## C. Verifiable execution (the anti-hallucination point)

- The agent claims an action only after the corresponding tool returned success. Never reports a
  created/updated record or a navigation that did not actually happen.
- The right pane reads from the **same** workspace state the tools mutate (via `/app/state`) — so "the
  agent said it created X" and "X exists in the app" are the same fact, provable by refetch. The pane
  renders **only** from `/app/state`, never optimistically from tool-call args. This directly counters
  the most damaging failure mode of summarize-without-verifying agent designs (claiming work not done).
- Tool failures (e.g. unknown work area) surface to the user rather than being papered over.

---

## D. UX / layout

- Lands directly in **split-screen** (chat left, live Tax Workbench app right) — **no** upload gate.
- App pane has working sidebar nav (Clients → Engagements → Work Areas; Templates; Information Requests;
  Documents) that a human can click *and* that the agent drives.
- **Documents area**: uploaded sources and AI-generated artifacts shown in **separate groups**; clicking
  opens a viewer (reuses `ArtifactsPanel` / `DocumentsList` / `ArtifactCanvas` + markdown/CSV renderers).
  The user can upload mid-session from the chat input (not a gate).
- Navigation/state changes are visually obvious (the pane changes screens; rows appear).
- The detailed trace panel is reachable but unobtrusive (collapsed by default).
- **Visual direction:** keep the current look/feel but **tone it down** — calm the ambient orbs/glow,
  drop the neon "MERIDIAN" branding for a neutral "Tax Workbench" mark, lighten heavy accents. Goal:
  reads as a credible tax app, not a full enterprise redesign.

---

## E. Reliability & feel

- All scenarios run on `python dev.py` locally end-to-end without manual fixups.
- **State + files live in a per-session workspace folder** (the proven RFP pattern), not a database.
  The agent's tools mutate the workspace; the app pane renders only from `/app/state`, so a created
  task/info-request persists and is visible across refetches *within the session*.
- **Fail loud:** missing/corrupt workspace state surfaces a clear error, never a silent fallback.
- "New session" creates a fresh workspace and reseeds clean application state.
- (No latency targets — efficiency is shown structurally via step count in the trace, not a stopwatch.)

---

## F. Technical architecture & data

**Topology (local-first, same shape as the proven RFP repo):**
```
Frontend (Next.js)  :3000
  └─ HTTP + SSE → Orchestrator (FastAPI) :8000   [SSE proxy, auth forwarding; never runs the SDK]
       └─ SSE proxy → Session Container (FastAPI) :8080   [Copilot SDK + tax tools + skills]
            ├─ Azure OpenAI  (reuse existing `taxagent-ai`, deployment gpt-4.1)
            └─ per-session WORKSPACE FOLDER  (app state JSON + uploaded/generated files)
```

**Azure footprint (intentionally minimal for the POC):**
- **Reused** Azure OpenAI / Foundry: `taxagent-ai`
  (`https://taxagent-ai.cognitiveservices.azure.com/openai`, deployment `gpt-4.1`). Verified → HTTP 200.
- **Reused** Azure Content Understanding + ADLS (rfp's `ADLS_ACCOUNT_NAME`/`ADLS_FILESYSTEM` + CU config)
  for upload conversion — kept so PDF/DOCX uploads work.
- **No database.** Application state lives in the per-session workspace folder (see below). The Cosmos
  account explored earlier (`taxworkbench-cosmos` + RG `tax-agent-rg`) has been **deleted**.

**Workspace folder = state + files (the RFP pattern):**
- Each session gets an isolated workspace dir (`WORKSPACE/<sessionId>/`). The Copilot SDK operates here.
- Application state is a JSON doc in the workspace (`.taxdb.json`): `currentRoute`, `context`,
  `clients`, `engagements`, `workAreas`, `tasks`, `templates`, `informationRequests`, `routes`. Seeded on
  session create.
- **Files**: uploaded sources (manifest-tracked, `origin: "uploaded"`) and AI-generated artifacts
  (`origin: "generated"`) both land in the workspace and are **displayed separately** in the UI (reuses
  the existing `ArtifactsPanel` / `DocumentsList` / `ArtifactCanvas`).
- Per-user isolation is preserved (one workspace per session). "New session" makes a fresh workspace.

**Production note (deferred, not POC scope):** longterm this targets **ACA dynamic sessions** (custom
container pool), where session sandboxes are *ephemeral* — the workspace persists for a live session but
is destroyed on cooldown. Durable, shareable state (e.g. Blob for files + a document DB for records) is a
**deferred** decision; the POC deliberately keeps state in the session workspace.

**Uploads (POC scope):** full upload support **kept**, including PDF/DOCX — non-text files run through
the reused Azure Content Understanding + ADLS conversion pipeline (orchestrator `content_processing.py`),
producing a markdown artifact the agent reads via `read_workspace_file`. Uploaded source + generated
artifacts display separately in the Documents area.

**State contract — `GET /sessions/{id}/app/state`** (orchestrator → session container → workspace JSON,
same proxy shape as `list_files`): returns the full application document for that session. The frontend
renders it verbatim and refetches after each tool/run completes.

**"Where am I" context:** the frontend attaches the user's current view (e.g. the active work area) as
lightweight context on each chat message, so the agent can resolve "here" / "this" — mirrors how the
legacy system passes the current page. Human sidebar clicks are client-side view changes only.

**Tool inventory (session container, Copilot SDK `define_tool`):**
- `navigate(destination)` — deterministic resolve → sets `currentRoute`/context; returns
  resolved / ambiguous(candidates) / not_found(candidates).
- `list_tasks(work_area?)`, `create_task(...)`, `update_task(...)`
- `list_templates()`, `get_template(id|name)`, `get_latest_template(category)`
- `list_information_requests(work_area?)`, `create_information_requests([...])` (bulk)
- `read_workspace_file(path?)` — read an uploaded source / generated artifact
- `write_file(path, content)` — save a generated document to the workspace
- Navigation reuses existing AG-UI `TOOL_CALL_*` events — **no new event type**; the frontend
  intercepts on tool name.

**Copilot SDK version:** build on the **latest `github-copilot-sdk` 1.0.1** (not the inherited 0.1.25).
This is a `0.x → 1.0` migration confined mostly to `agent.py`: `create_session(dict)` → kwargs
(`provider`/`system_message`/`hooks`/`available_tools`/`skill_directories`/`skip_custom_instructions`),
`provider.wire_api` `"chat"` → `"completions"`, `send("text")` + `disconnect()`, and event dispatch on
typed `*Data` classes (field names unchanged). New `SkillInvokedData` feeds the "loaded skill" trace.

**Detailed trace panel data source:** the session container already writes structured per-turn traces
(`logs/trace.jsonl`) and raw SDK events (`logs/sdk-events/<session>.jsonl`). The trace panel is fed by
these (surfaced via an endpoint), giving real tool-call + LLM-step ordering and timings.

---

## G. Explicitly out of scope (avoid over-building)

- No real third-party tax systems or auth — mock data in the session workspace folder.
- No database for the POC (no Cosmos). No Azure *deployment* of the app (processes run local-first).
  ACA dynamic-sessions deploy + durable external state are deferred longterm work.
- No KB/retrieval, no voice mode, no reminders/tagging.
- Only the chosen use cases.

---

## H. Demo acceptance — the single end-to-end run that must pass

One Playwright journey driven against localhost (frontend :3000), as a real user, that exercises:
land in app → navigate to Federal Compliance → create a task (see it appear) → ambiguous nav +
disambiguate → show latest engagement letter → bulk-create 3 info requests (see 3 rows) — with the
chat showing friendly step summaries, the trace panel showing tool calls + LLM steps + timings, and
every agent claim matching on-screen state.

**Evidence — Playwright screenshots captured on localhost, saved and committed:**
- A screenshot is captured at each meaningful step and saved under `screenshots/poc/` with ordered,
  descriptive names, e.g.:
  - `01-landing-split-screen.png` — app + chat on first load
  - `02-navigate-federal-compliance.png` — right pane on the Federal Compliance work area
  - `03-task-created.png` — new task row visible in the work plan
  - `04-ambiguous-nav-options.png` — agent's disambiguation candidates
  - `05-disambiguated-navigated.png` — landed after the user picks
  - `06-latest-engagement-letter.png` — Templates screen showing v3.2
  - `07-bulk-info-requests.png` — 3 new information-request rows
  - `08-inline-step-trace.png` — the inline Claude-style step trace + per-turn meta (step count +
    duration). The inline chat trace IS the trace surface by design (Decision 7); there is no separate
    panel, so the evidence doesn't imply one.
- Each screenshot is **examined** (not just captured); the run confirms agent claims match rendered
  state. A short `screenshots/poc/README.md` maps each image to the criterion it proves.
- **Proof of real persistence:** after a create, a page reload (fresh `/app/state` fetch from the
  workspace) still shows the record — captured as a screenshot — proving it's real persisted state, not
  chat-only echo.

---

## I. Quality bar — independent multi-agent review must converge on "high quality"

The POC is not "done" when it merely works. A panel of **independent review subagents** critiques the
**live, running app** (real Playwright screenshots + interaction) and the code, from distinct lenses.
Reviewers are run adversarially — instructed to find what's weak, not to rubber-stamp. The build then
iterates (fix → re-review) until the panel **converges**: every reviewer rates the work high-quality
with **no unresolved major/blocking findings**.

**Review lenses (each an independent subagent):**
- **UX / visual design** — layout, visual hierarchy, polish, split-screen balance, trace-panel
  legibility; does it read as a credible, modern product rather than a demo skeleton.
- **Usability / interaction** — flows feel natural; friendly step summaries are clear; navigation and
  state changes are obvious; ambiguity and error states are handled gracefully.
- **Demo narrative / pitch** — the running app makes the architectural point land on its own:
  verifiable execution (claims match on-screen state), single-tool-call efficiency, trace visibility.
- **Architecture / code quality** — faithful to the proven repo patterns; fail-loud, no silent
  fallbacks or shims; clean and maintainable; matches the documented architecture.

**The iterative review → fix loop (this is the mechanism, run as a deterministic orchestration):**

Each **round N** does the following, in order:

1. **Validate (Playwright, live):** run the full acceptance journey (Section H) against localhost as a
   real user and capture *fresh* screenshots for this round into `review/round-N/screens/`. Stale
   screenshots are never reused — every round re-photographs the current build.
2. **Fan out adversarial reviewers (parallel, independent):** spawn the review-lens subagents
   (UX/visual, usability, demo-narrative, architecture/code) *fresh* each round. Each receives only:
   this round's screenshots, the relevant code, and these success criteria — **not** prior verdicts, so
   no reviewer can coast on an earlier "approve." Each is instructed to actively hunt for weaknesses and
   returns structured findings (`blocking`/`major`/`minor`) + a verdict (`high-quality`/`not-yet`).
3. **Synthesize / triage:** a synthesizer pass dedupes findings, drops false positives (verifying each
   against the actual screenshots/code), and ranks the survivors. Output: this round's fix list +
   per-lens verdicts, saved to `review/round-N/findings.md`.
4. **Fix:** apply every `blocking` and `major` fix. `minor` items are logged, not necessarily fixed.
5. **Loop:** go to round N+1 (which re-validates with new screenshots and re-reviews the changed app).

**Guarantees that "multiple iterations" actually happen (not claimed):**
- **No round-1 pass.** Convergence requires a *clean re-review*: the final passing round must come
  *after* at least one round that produced and fixed `blocking`/`major` findings. A first-round
  all-clear triggers one more confirming round, never an immediate exit.
- **Evidence per round.** Each round archives `review/round-N/screens/*` + `findings.md` + verdicts, so
  the iteration count and what changed between rounds are auditable.
- **Regression-aware.** Because every round re-runs the full Playwright journey, a fix that breaks a
  previously-good screen is caught by the next round's validation, not assumed away.

**Exit / stop conditions:**
- **Converged (success):** in a re-review round, *all* lenses return `high-quality` with **zero open
  `blocking`/`major`** findings. `minor` nits are logged as known.
- **Cap (fail loud):** hard cap of **5 rounds**. If not converged by then, stop and report the
  outstanding findings honestly — do **not** declare success. (No silent "good enough.")
- The converged (or final) round's `findings.md` + verdicts + screenshots are the saved acceptance
  evidence.

---

## Decisions locked

1. Split-screen chat + live mock "Tax Workbench" app. Generic tax domain; no third-party product branding anywhere in the project.
2. **State + files in a per-session workspace folder** (RFP pattern) — **no database / no Cosmos** for
   the POC. Reuse Azure OpenAI `taxagent-ai`. Durable external store + ACA deploy are deferred longterm.
3. KB disabled for the POC.
4. No upload gate — land directly in the app; uploads available mid-session, full formats incl.
   PDF/DOCX via the reused Content Understanding + ADLS conversion pipeline.
5. Uploaded sources and AI-generated artifacts both live in the workspace and are shown separately
   (reuse existing artifact UI).
6. Keep current UI look/feel but tone it down (calmer accents, neutral "Tax Workbench" branding).
7. **User-facing trace is the priority**: polished, Claude-style inline multi-step tool-call display in
   chat. A detailed/raw trace panel is optional (our discretion), not a requirement.
8. Tools **and** skills (4 markdown skills authored). The real bar is **general helpfulness** — handles
   a wide variety of in-domain asks, calls tools, adjusts on the fly — judged by the review panel, not
   rigid scripts.
9. **Conversation continuity** across turns is required (resolves "it"/"that" from prior context).
10. Frontend passes the **current view as context** per message so the agent can resolve "here"/"this".
11. Acceptance requires committed localhost Playwright screenshots proving each scenario.
12. No latency targets.
13. Final acceptance gate: a panel of independent, adversarial review subagents (UX, usability, demo
    narrative, architecture/code) must converge on "high quality" with no open blocking/major findings;
    the converged review is saved as evidence.
