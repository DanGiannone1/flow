# Critique Round 1 — critical tax pros vs claude.ai OOTB

3 reviewers (senior preparer, signing partner, claude.ai power-user) live-probed the app
(`node scripts/probe.mjs`) and compared head-to-head with claude.ai. All three verdict: **would
not use over claude.ai today** — same model, app adds little, and it introduced correctness risk.

## Convergent findings → fixes applied (round-1 gap)

| # | Finding (who) | Fix | Verified |
|---|---|---|---|
| 1 | **No deterministic computation** — free-hand arithmetic gave TWO different tax numbers for the same client ($11,675,000 vs $11,435,000, double-deducted charitable); partner found a self-contradictory derivation | New **`compute_tax`** tool (M-1 walk → taxable income → federal tax, deterministic); system prompt + skill route all arithmetic through it | ✅ two phrasings now both give $11,675,000 / $2,451,750 |
| 2 | **Over-declines computable things** — refused to compute estimated payments though it had prior-year tax + the law | New **`compute_estimated_payments`** (safe harbor, 25% installments, due dates); prompt distinguishes "missing client fact" (decline) vs "compute from known law" (do it) | ✅ now computes 4×$389,550 due 4/15–12/15/2026 |
| 3 | **False premise honored** — adopted a fabricated Rev. Rul. + wrong 80% meals rule; falsely claimed it lacked data it has | Prompt: challenge false premises, never honor unverifiable authority, read the client doc before figure answers | ✅ now: "Rev. Rul. 2019-44 is not in the firm reference … 50% of $350,000 = $175,000" |
| 4 | **Wrong/ungrounded IRC cites** — §162(f) for the federal-tax add-back (should be §275); statute numbers model-recalled | Added §275(a)(1) to firm policy; prompt: only cite an IRC section that appears in a read doc, else describe the rule without a number | ✅ wrong §162(f) cite gone |
| 5 | **Fabricated facts under [S] citations** — claimed a vacation payment date the doc doesn't state | Prompt: a citation must point to a source that ACTUALLY contains the claim; if a fact isn't in the data, say "not stated — confirm" | applied (prompt) |
| 6 | **PBC email asked for docs already received** — never read the PBC doc | Prompt + skill: for "outstanding PBC" read the PBC doc first; report only items it marks outstanding | applied (prompt/skill) |
| 7 | **No artifact provenance / AI-draft stamp** (partner BLOCKER) | Always-on **"AI-generated draft · unreviewed"** banner on every artifact (frontend, reliable) + a draft header line in saved deliverables | ✅ banner renders |
| 8 | **Dock orphans artifacts** — generated memo "saves invisibly" (§4.3 card never built) | **Dock artifact card** → one click opens it in the workspace canvas | ✅ card renders + opens workspace |

## Still open after round 1 (carry into round 2/3)
- **The app surface itself still doesn't compute** — compute now happens in chat→artifact, but
  there's no live editable M-1/provision GRID in the app (reviewers' "CRUD shell" critique).
  Bigger build; assess whether the compute-tool+artifact is "enough" or a grid is needed.
- Citation chips still don't open the source span (partner MAJOR4) — only show the filename.
- Multi-turn continuity across sessions (claude.ai still wins).
- §163(j) ATI detail (EBIT post-2022); workpaper "add-back under Subtractions" header grouping.