# Polish review — iteration 1 (broadened perspectives)

Four new lenses (blind), on `review/polish-1/screens`: **business, UI/UX craft, correctness/stability,
tax-domain credibility.** All four returned `not-yet` with actionable findings.

## Findings + disposition

### Correctness / stability
- **[blocking] No SDK turn cancellation** — Stop/New-Chat aborted only the browser fetch; the SDK turn
  kept running and tools kept writing (could race a New-Chat `rmtree`). → **FIXED**: `session.abort()` on
  generator teardown when a turn is still active (`agent.py`).
- **[major] Inactivity timeout silently ended the turn** (looked finished, no error). → **FIXED**:
  `sse.ts` surfaces a `RUN_ERROR` on inactivity cancel.
- **[major] Proxy `aiter_lines` strip/rejoin** fragile for multi-line frames. → **FIXED**:
  `session_manager.py` passes raw bytes through (`aiter_raw`).
- **[minor]** dead token re-check (`server.py`) → **removed**; double-submit guard render-dependent →
  **FIXED** with a synchronous `inFlightRef`.
- **[major] reset blocks behind session lock** for the whole turn → mitigated by abort (turn ends, lock
  frees); full signal-cancel deferred (logged).

### Tax-domain credibility
- **[major] Q3 estimate created as "General"** not Obligation. → **FIXED**: `create_task` infers
  Obligation from filing/payment markers; skill already guides it.
- **[major] taxYear 2022 with 2026 due dates.** → **FIXED**: engagements bumped to **2025**; Form 1120 due
  corrected to **2026-10-15** (C-corp extended).
- **[minor]** assignee literal "me" → **FIXED** (`me`/`myself` → "You"); thin engagement letter →
  **enriched** (return/year specificity + e-file consent + signature block).

### UI/UX craft
- **[major] dead `backdrop-blur` property** (glass effect silently off). → **FIXED** → `backdrop-filter`
  (+ `-webkit-`).
- **[major] suggestion-card titles / KPI labels wrap inconsistently** breaking the baseline grid. →
  **FIXED**: fixed-height card title + `min-height` on stat labels.
- **[major] chat dead-zone on sparse screens.** → mitigated: empty-state centered lower; work-area now
  carries engagement context + always-on Information Requests section.
- **[minor]** IR empty state bare → **styled dashed card + icon**; faint assistant-bubble border →
  **contrast lifted**; trace/prose redundancy + card-grid alignment → logged.

### Business / value (mostly deck, per locked "no fabricated baseline in-UI" decision)
- **[blocking] architectural advantage invisible in-artifact; [major] no cost story; [major] steelman /
  migration; [major] durability honesty** → captured in **`PITCH-NOTES.md`** (contrast table from real
  legacy-system traces, cost lever, honest latency framing, production-architecture slide). Not fabricated into UI.
- **[major] show (not tell) governance/fail-loud; [minor] prove off-script helpfulness** → **FIXED in
  evidence**: e2e now captures `10-fail-loud-not-found` (unknown destination → honest refuse + chips) and
  `11-offscript-overdue` (composed unscripted query).

Post-fix: e2e **13/13** (`review/polish-2/screens`).
