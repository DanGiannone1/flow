# POC acceptance screenshots

Captured on localhost by `node scripts/poc_e2e.mjs` (real frontend, real Copilot SDK 1.0.1 agent,
real Azure OpenAI). Each maps to a success criterion in `../../POC-SUCCESS-CRITERIA.md`.

| Screenshot | Proves |
|---|---|
| `01-landing-split-screen.png` | D — lands directly in split-screen (chat + live Tax Workbench app); no upload gate; toned-down enterprise UI |
| `02-navigate-federal-compliance.png` | A.1 — "Take me to Federal Compliance" routes the app pane to the work area; honest "Navigated" step + per-turn meta |
| `03-task-created.png` | A.2 / C — created Q3 task appears as a real row (NEW badge), agent claim matches on-screen state |
| `04-ambiguous-nav-options.png` | A.1 / B / C — "go to compliance" shows **"Needs clarification"** (not a false success) + **clickable candidate chips** |
| `05-disambiguated-navigated.png` | A.1 — picking a candidate navigates to State & Local Compliance |
| `06-latest-engagement-letter.png` | A.3 — resolves the **latest** engagement-letter template (v3.2), opens it, renders content |
| `07-bulk-info-requests.png` | A.4 — pasted block → **one** `create_information_requests` call → 3 rows in the work area |
| `08-inline-step-trace.png` | B — Claude-style inline step trace + per-turn meta (`N tool calls · X.Xs`); the inline trace IS the trace surface (no separate panel, by design) |
| `09-persistence-after-reload.png` | C / E — after reload, created records still present (read fresh from workspace state, not chat echo); transient "New" badges correctly cleared |

**Acceptance:** e2e 11/11 on localhost; the Section I adversarial review panel (UX, usability,
demo-narrative, architecture) converged on **high-quality** at round 4 with zero open blocking/major
findings, after three prior rounds of real fixes. Per-round evidence: `../../review/round-N/`.
