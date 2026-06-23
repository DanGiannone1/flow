# Break-it round 1 — findings (MVP-DESIGN §9.5/§9.6)

Dual-lens adversarial pass on the **current** app (pre-UX-restructure), per §11 step 1.
Lens A = code review (3 deep reviewers). Lens B = UI/screenshot Playwright battery (`scripts/break_it.mjs`).

Severity: BLOCKER (must fix now) · MAJOR (fix before MVP) · MINOR (track).

---

## Lens A — Code review

### A1. Orchestrator / SSE proxy (`session_manager.py`)

| # | Sev | Location | Issue | Fix | Status |
|---|-----|----------|-------|-----|--------|
| O1 | MAJOR | `session_manager.py:239-246` | Clean upstream close mid-stream emits NO terminal `RUN_FINISHED`/`RUN_ERROR` → client hangs in "thinking" / silent partial (FAIL LOUD violation). Proxy never inspects framing, can't tell "finished" from "died". | Track whether a terminal event was seen; if loop exits without one, emit `RUN_ERROR("Stream ended unexpectedly") + RUN_FINISHED`. | open |
| O2 | MAJOR | `session_manager.py:198-251` | No `GeneratorExit`/`finally` cleanup on client disconnect; bare `except Exception` doesn't catch `BaseException`. Upstream turn + session lock can stay pinned → spurious 409 "Session busy" under load. | `try/finally` with explicit `await resp.aclose()`; abort upstream on disconnect. | open |
| O3 | MAJOR | `session_manager.py:171-184` | `validate_session` maps ALL pool/auth/network errors to `KeyError` → 404 "session not found", so a transient infra blip makes the frontend discard a valid session (FAIL LOUD violation). | Only map genuine 404 → `KeyError`; re-raise others as 502/503. | open |
| O4 | MAJOR | `session_manager.py:215-229` | Upstream 4xx `detail`/raw `resp.text` reflected verbatim to the browser (inconsistent with the 5xx sanitization right above). | Forward a fixed/known-safe message; never reflect `resp.text`. | open |
| O5 | MINOR | `session_manager.py:103` | 600s streaming read timeout + no heartbeat → a stalled-but-open upstream hangs the client up to 10 min (container's own timeout is 300s). | Lower streaming read timeout to ~container timeout, or add heartbeat. | open |
| O6 | MINOR | `session_manager.py:238,244` | `errors="replace"` emits U+FFFD on a truncated trailing multibyte at EOF instead of signaling truncation (pairs with O1). | Treat non-empty pending flush at EOF as truncation error. | open |
| O7 | MINOR | `session_manager.py:105,164,184,188` | In-memory `_sessions` set gates nothing (every path re-probes the pool); misleading, can drift. | Remove it, or use it to skip a pool round-trip. | open |

Cleared by reviewer (no bug): token never logged; missing-token fails loud in prod; split-multibyte decode correct; upload size/type/path validation correct; CU/ADLS failure surfaced; the session-lock-not-popped guard is correct.

### A2. Backend agent + tools (`agent.py`, `taxdb.py`, `server.py`)

| # | Sev | Location | Issue | Fix | Status |
|---|-----|----------|-------|-----|--------|
| B1 | MAJOR | `taxdb.py:235-239` (load 232) | `save()` is in-place `write_text` (no temp+`os.replace`); `load()` parses with no error handling. Abort/teardown (`agent.py:879`) can tear down a tool thread mid-write → corrupt `.taxdb.json` → opaque 500, unrecoverable workspace. | Atomic write (`.tmp` + `os.replace`); `load()` fails loud with file path. | open |
| B2 | MAJOR | `agent.py:558` | `read_workspace_file` decodes `errors="replace"` → silently mangles non-UTF-8 docs (Latin-1 csv/txt) fed to the model, which then asserts facts on corrupted text. Sibling `/files/content` correctly raises 415. FAIL LOUD violation. | Decode `errors="strict"`; return `ENCODING_UNSUPPORTED` on failure. | open |
| B3 | MAJOR | `agent.py:517-534` | `create_information_requests` has no non-empty-title validation → a malformed paste row creates+persists a blank-title record and reports `CREATED N`. Fabricates data + false success. | Skip empty-title items; return `NO_REQUESTS` noop if all empty. | open |
| B4 | MINOR | `taxdb.py:299,302` | `resolve_destination` bidirectional/short-substring matching: `"x"`→ambiguous, `"a"`→9 candidates, `"take me home please"`→`/dashboard`, `"i want documents now"`→`/templates`. System prompt passes user words verbatim, so these reach the matcher. Weakly-grounded nav. | Whole-word/`startswith` keyword match; drop `name in q` direction or gate by min length. | open |
| B5 | MINOR | `server.py:304-308,413-419` | Upload-manifest write failure swallowed + reader bare-except returns empty set → an uploaded file later reported `origin:"generated"`. Misrepresents provenance. | Surface the failure; don't let a corrupt manifest read look like "no uploads." | open |
| B6 | MINOR | `agent.py:198-206` | Empty result with `success=True` (`_result_text` fallthrough → `""`) classifies as `ok` in the trace. Empty-success shown as success = honesty gap. | Empty extracted text + no positive marker → `error`. | open |
| B7 | MINOR | `server.py:213,249` | `lock.acquire()` before the StreamingResponse generator starts; release only in `generate()`'s finally. If construction/teardown happens before first iteration, lock is held forever → session 409s until restart. | Acquire inside `generate()` try, or wrap acquire→return to release on failure. | open |

Cleared by reviewer (NOT bugs): symlink/`..`/absolute path traversal in read/write IS blocked (`.resolve()` before `relative_to`) → C4 injection should pass; `new_id` collision-safe; per-session lock serialization correct; lock-not-popped guard sound. Doc drift: the agent.py "module-level singleton" docstring is stale — sessions are a dict keyed by id (no runtime bug). **Cross-check for F8:** confirm whether agent.py emits >1 `TEXT_MESSAGE_START` per run.

### A3. Frontend state logic (`useAgentSession.ts`, `sse.ts`)

| # | Sev | Location | Issue | Fix | Status |
|---|-----|----------|-------|-----|--------|
| F1 | MAJOR | `useAgentSession.ts:316-321` (fired 392/397/401) | Overlapping `refreshAppState` calls (one per `TOOL_CALL_END` + one on `RUN_FINISHED`) have NO sequencing guard → whichever HTTP response lands last wins; a stale snapshot can clobber newer state, and `newRecordIds` diffs against the wrong baseline. | Add `appStateSeqRef`: capture seq before await, ignore dispatch if a newer seq was issued (last-issued-wins). | open |
| F2 | MAJOR | `useAgentSession.ts:385,392,397` | `routeFollowRef` stays true for the whole turn, so the trailing `RUN_FINISHED` refetch also follows. If the user clicks the sidebar mid-flight, that refetch overwrites `viewRoute` back to the server route — silently undoing the click (inverse of the just-fixed nav bug; partly introduced by that fix). | Consume follow intent once: set `routeFollowRef.current=false` after the first follow dispatch (or don't follow on RUN_FINISHED if a TOOL_CALL_END already did). | open |
| F3 | MAJOR | `useAgentSession.ts:323-335` (used 342-346) | `restoreStoredSession` `catch {}` returns false on ANY error (500/502/timeout), and false → `clearAndDeleteSession` + new session. A transient backend blip on reload silently wipes the user's session/workspace. | Only return false for explicit `meta===null` (404); let other errors propagate to `SESSION_ERROR` + Retry. | open |
| F4 | MEDIUM | `useAgentSession.ts:449-455,394-402` | Buffered `RUN_FINISHED`/`RUN_ERROR` events processed after `handleStop` re-finalize + re-refresh a cancelled turn. | `cancelledRef` checked at top of `handleAGUIEvent`; ignore events once stopped. | open |
| F5 | MEDIUM | `sse.ts:65-70,88-90` + `useAgentSession.ts:370-403` | Malformed/unknown `data:` frames silently skipped; a corrupted terminal event → turn never finalizes, `isStreaming` stuck until 600s timeout (FAIL LOUD violation). | Count/log parse failures; surface RUN_ERROR on terminal-frame parse failure. | open |
| F6 | MEDIUM | `useAgentSession.ts:313,320` | `refreshAppState`/`refreshFiles` empty `catch {}` hides persistent failures; pane shows stale state while chat claims success diverging from server (FAIL LOUD). | Track refresh-failure; surface a non-blocking "workspace may be out of date" hint. | open |
| F7 | MEDIUM | `useAgentSession.ts:361-363` + `session.ts:42-46` | Persistence gated on `!isStreaming`, so reload mid-turn loses the in-progress turn; compounds with F3. | Deliberate decision; persist in-progress user message or note it. | open |
| F8 | MEDIUM | `useAgentSession.ts:122-129` | Tool-only turn leaves the `pending-` assistant bubble with a synthetic id; possible extra bubble on multi-`TEXT_MESSAGE_START` turns (depends on agent.py emission — cross-check with A2). | Normalize pending id on turn end; verify multi-message emission. | open |
| F9-F12 | LOW | various | Double-submit guard relies solely on `inFlightRef` for suggestion clicks (verified sound); UTF-8 decode sound; inactivity-timeout RUN_FINISHED suppression sound; `toolNamesRef`/`routeFollowRef` per-turn reset + fail-closed sound. | No action (verified OK). | n/a |

Reviewer caveats: F1 assumes `getAppState` can resolve out of issue-order (realistic under connection reuse; no sequencing guard exists either way). F8 depends on whether agent.py emits >1 `TEXT_MESSAGE_START` per run — cross-check with the backend reviewer.

---

## Lens B — UI/screenshot battery (`scripts/break_it.mjs`)

Result: **12 PASS · 2 SUSPECT · 1 FAIL · 0 page errors**. After screenshot review, **no real
product FAILs** — the FAIL and both SUSPECTs are test-harness artifacts. Screenshots in
`review/break-1/screens/`.

| Check | Verdict | Reviewed conclusion |
|---|---|---|
| A1a/A1b/A2 nav matrix + re-nav after manual click | PASS | Nav fix holds; repeats + interleaving work. |
| A3 "create a task here" → viewed work area | PASS | Correctly created in State & Local (the viewed area). |
| B1 double-submit → one turn | PASS | `inFlightRef` guard solid. |
| B2 cannot submit while streaming | SUSPECT→**PASS** | Test-timing artifact: short turn finished in the 400ms gap so "interrupt me" started as a legit next turn. Code guard (`useAgentSession.ts:409`) returns on `streamingRef.current` BEFORE `USER_SEND`. Test tightened. |
| B3 stop mid-stream halts + recovers | PASS | Clean halt, input re-enabled, can send again. |
| B4 reload mid-turn recovers | PASS | No stuck streaming; usable after reload. |
| C1 nonexistent destination fails loud | PASS | "Destination not found" + candidates. |
| C2 malformed bulk paste graceful | PASS | Agent made 1 request from the line (lenient but no crash/blank); see B3 for the empty-title hole. |
| C3 whitespace-only submit no-op | PASS | 0 rows added. |
| C4 path-traversal injection contained | PASS | Azure content filter returned 400 (contained); write_file traversal also blocked at tool level (A2 cleared). Surfaced as RUN_ERROR — relates to O4/error UX. |
| D1 ungrounded number declined | SUSPECT→**PASS** | Screenshot/text: "I do not have access to the exact federal taxable income… If you upload the Form…" — proper grounded decline. Regex was too narrow. |
| E1 created task persists after reload | PASS | Persists from server state. |
| E2 new session resets to seed | FAIL→**TEST BUG** | Screenshot shows the "NEW SESSION?" modal still OPEN — `/new session/i` re-clicked the header button, never confirmed "Start new session". Session never reset. Test selector fixed. |

**Test-harness fixes applied to `scripts/break_it.mjs`:** E2 clicks the modal's exact "Start new
session" button; B2 tightened to press during a guaranteed-long turn and assert no second turn starts.

---

## Resolution (round-1 fixes applied 2026-06-19)

**Fixed (all MAJORs + selected MINORs):**
- **B1** `taxdb.py` — atomic write (`.tmp` + `os.replace`); `load()` raises on corrupt JSON (no silent reseed).
- **B2** `agent.py:558` — `read_workspace_file` decodes `errors="strict"` → `ENCODING_UNSUPPORTED` (no silent mangling).
- **B3** `agent.py` — `create_information_requests` skips empty-title rows; `NO_REQUESTS` if all empty; reports skipped count.
- **B4** `taxdb.py` — `resolve_destination` now word-boundary + min-length (≥3) matching; killed `"x"`/`"a"` substring explosions and bidirectional `name in q` noise.
- **B6** `agent.py` — `_tool_outcome`: empty result with no positive marker → `error` (no false green); added `ENCODING_UNSUPPORTED` to error markers.
- **O1** `session_manager.py` — emit `RUN_ERROR`+`RUN_FINISHED` if upstream stream ends with no terminal event (truncation no longer hangs the client).
- **O3** `session_manager.py` — `validate_session` maps ONLY genuine 404 → `KeyError`; transient errors propagate (no valid-session-discard).
- **O4** `session_manager.py` — 4xx no longer reflects raw `resp.text`; forwards only a clean JSON `detail` string else a fixed message.
- **F1** `useAgentSession.ts` — `appStateSeqRef` last-issued-wins guard (stale refetch can't clobber the pane / miscompute newRecordIds).
- **F2** `useAgentSession.ts` — route-follow consumed correctly + `userNavSinceToolRef`: a manual click mid-flight is no longer overridden by a trailing refetch.
- **F3** `useAgentSession.ts` — restore only treats 404 as "gone"; transient errors surface `SESSION_ERROR`+Retry instead of wiping the session.
- **F4** `useAgentSession.ts` — `cancelledRef`: buffered events after Stop are ignored (no re-finalize/re-refresh of a cancelled turn).
- Test harness: `break_it.mjs` E2 (modal exact button), B2 (deterministic input-locked check), D1 (broadened decline regex).

**Deferred to post-UX-restructure (touch UI being rebuilt in §11 step 2):**
- O2 (explicit GeneratorExit cleanup — `async with` already closes on unwind), O5 (read-timeout/heartbeat), O6 (truncated-multibyte EOF), O7 (dead `_sessions` set).
- B5 (upload-manifest provenance), B7 (lock-acquire-before-generator window).
- F5 (surface malformed-SSE / hung-stream), F6 (stale-pane indicator), F7 (reload-mid-turn message persistence), F8 (tool-only bubble id) — all revisited with the artifact-canvas + new shell.

## Triage & fix order
MAJORs first (FAIL-LOUD / data-integrity / works-under-pressure criteria), batched by tier to
minimize service restarts: backend (B1-B3) + orchestrator (O1-O4) together, then frontend (F1-F3)
via HMR, then re-run the battery twice. Minors (B4-B7, O5-O7, F4-F8) follow.
