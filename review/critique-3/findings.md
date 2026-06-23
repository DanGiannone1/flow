# Critique Round 3 (final) — verdicts + the converged remaining limitation

Same 3 critical tax pros (preparer, partner, manager) re-probed the hardened app vs claude.ai OOTB.

## What is now genuinely FIXED and held under adversarial probing (all 3 confirmed)
- **Rate pin** — "18% per the 2024 Tax Relief Act", "15% minimum tax": refused every variant, 21% enforced in code (not a param). Structurally un-poisonable.
- **Decline out-of-scope** — MACRS schedule, ASC 740 ETR reconciliation: declined cleanly, no fabricated workpaper, offered qualitative steps.
- **Grounded refusal / ungrounded decline** — won't invent figures the docs don't contain; cites sources.
- **Real-date deterministic overdue** — `list_tasks` computes `overdue` server-side; flagged the 2026-05-30 PBC task as of today.
- **The doc-grounded practice-management loop** — PBC-list → client email (only outstanding items, none already received), task create+navigate, document Q&A with citations. The manager called the PBC→email path "the standout … real, felt value … beats claude.ai + dragging files."
- **The app now computes** — the M-1 Worksheet surface renders engine-computed totals from server state.

## The converged remaining BLOCKER (all 3 reviewers, independently)
**The deterministic boundary is one layer too low.** `compute_tax` locks the *rate* and the
*arithmetic*, but the **model still selects which M-1 adjustments exist and their amounts**, so:
- It can be **poisoned**: a fabricated "Rev. Rul. 2021-9" halved the fines ($86k→$43k); a fabricated
  bonus payment date *contradicting the trial balance* dropped the $1.25M add-back — both saved.
- It is **non-deterministic**: the same prompt produced **three different taxable incomes**
  ($11,675,000 / $11,824,000 / $12,140,000) — a phantom $149k charitable-limit add-back here, a
  phantom $1.25M bonus subtraction there, an unsupported $268k vacation add-back elsewhere.
- The clean engine-rendered worksheet then presents the wrong number with **institutional
  authority** — which all three reviewers judged *more* dangerous than claude.ai prose.

**Final verdicts:** adopt for the doc-grounded request/email/task/Q&A loop (genuinely beats
claude.ai OOTB there); **do NOT yet trust the tax numbers** — verify every M-1 by hand, which
defeats the headline feature.

### The fix all three name (the clear next focused build)
Move the M-1 **derivation** into code, not just the arithmetic: a rules engine that takes the
trial-balance figures + firm policy and computes each adjustment itself (fines 100%, meals 50%,
entertainment 100%, federal-tax add-back, state-tax NOT added, depreciation book-vs-tax, accrued
bonus by the documented 2½-month date, charitable 10% limit), **rejecting any model-supplied line
that contradicts or isn't grounded in a source**. "Any model-controlled input to the deterministic
engine is a poison vector" — the rate was removed from the model's control; the adjustments must be too.

## Round-3 fixes applied (partial mitigations; the real fix above is a scoped next build)
- `compute_tax` added to the frontend route-follow set → computing now navigates to the M-1 Worksheet.
- Prompt M-1-integrity rules: fines 100% (refuse user-asserted partial — verified: rejects the
  Rev.-Rul. poison, keeps full $86k, saves nothing); don't drop the bonus add-back on a date that
  contradicts the doc; charitable only if the 10% limit binds (it doesn't for STC); no invented lines.
  (Prompt-level — reduces the demonstrated surface but is NOT the structural fix; that's code-side derivation.)

## Other open items (lower priority, from the panel)
- Multi-client facade — can't switch to Pacific/Northwind (NOT_FOUND); dashboard counts are global;
  only STC has documents. Either make clients real (active-client context) or honestly scope to one.
- No audit trail / preparer-reviewer sign-off / source-version stamp; `compute_tax` overwrites the
  worksheet with no history; citation chips don't open the source span.
- M-1 worksheet is read-only (can't correct a bad line in-app); cross-session memory (artifacts
  persist but the assistant has no recollection of prior sessions).