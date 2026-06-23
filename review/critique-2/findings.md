# Critique Round 2 — re-eval after round-1 fixes (still vs claude.ai OOTB)

Same 3 critical tax pros (preparer/compute, partner/trust, manager/workflow) re-probed live.
Verdicts moved up ("for the M-1/tax loop it now beats claude.ai") but converged on what's left.

## Round-2 findings → fixes applied (round-2 gap)

| # | Finding (who) | Fix | Verified |
|---|---|---|---|
| 1 | **Fabricated tax RATE honored + baked into a workpaper** — `compute_tax` took a free `federal_rate`, so "18% per the 2024 Tax Relief Act" got a deterministic veneer (partner BLOCKER) | Rate **pinned to 21% in code** (removed the param); prompt challenges ANY user-asserted rate/statute/act/ruling not in a read doc | ✅ now: "fixed at 21% … I cannot apply 18% unless documented" |
| 2 | **Model free-hands arithmetic around the tool** — overrode a correct $10,425,000 with a hand-computed $9,175,000 (preparer BLOCKER) | Prompt: report `compute_tax` output VERBATIM, never recompute/adjust in prose; the M-1 totals now live in the engine-owned worksheet | engine owns totals (worksheet) |
| 3 | **Out-of-scope computations free-handed + wrong + saved** (MACRS, ASC 740 ETR) (preparer BLOCKER) | Prompt: only compute what a deterministic tool covers; otherwise DECLINE — don't free-hand a workpaper | ✅ MACRS now declined ("not supported … use external software") |
| 4 | **The app does no tax work — needs a live M-1 grid where the engine owns the math** (all three — THE convergent directive) | New **M-1 Worksheet surface**: `compute_tax` persists the worksheet to `/app/state`; the app renders it as a structured grid (book income → adjustments → taxable income → tax) with **engine-computed totals**, own nav entry + route | ✅ renders: taxable income $11,675,000, tax $2,451,750 |
| 5 | **No real date → unreliable "overdue"** (manager BLOCKER) | Inject `[Today: …]` into every turn; `list_tasks` computes an `overdue` flag server-side (excludes Complete); seeded a genuinely-overdue task; removed the misleading hardcoded date in the starter | ✅ now flags the 2026-05-30 PBC task overdue as of today |
| 6 | **Estimates: large-corp safe-harbor not auto-detected** (preparer MAJOR) | Prompt: check prior-year taxable income vs $1M; set `large_corporation=true` if ≥ $1M | applied (prompt) |

## Still open after round 2 (carry into round 3)
- **Multi-client facade** (manager MAJOR) — dashboard shows 3 clients but only STC has documents; the other clients are dead weight.
- **No audit trail / preparer-reviewer sign-off / source-version stamp** (partner MAJOR) — artifacts are anonymous; the provenance banner is uniform chrome.
- **Citation chips don't open the source span; IRC cites get no treatment** (partner MAJOR).
- **Cross-session memory** (claude.ai still wins for multi-day work).
- Editable/recomputing M-1 grid (current surface is engine-computed but read-only).