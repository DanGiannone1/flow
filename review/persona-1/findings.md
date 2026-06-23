# Persona review round 1 + convergence (MVP-DESIGN §9.3/§9.6)

Multi-perspective adversarial review on the capability-complete app, then a fix round, then a
convergence re-review. Evidence: screenshots under `review/ux-restructure/`, `review/capabilities/`,
`review/break-7..9/`; corrected artifact at `workspace/*/book-tax-adjustments.md`.

## Round 1 — BLOCKERs found
| Persona | BLOCKER | Status |
|---|---|---|
| Tax-practitioner | M-1 artifact added back STATE income tax as a permanent difference (wrong — deductible federally §164) with a fabricated citation to the firm policy | FIXED — firm policy now states state tax is deductible (don't add back); regenerated artifact omits it |
| Tax-practitioner | Trial balance didn't foot ($726k gap) | FIXED — seed corrected; ties to 9,044,000 pre-tax / 6,584,000 after-tax |
| Tax-practitioner | Limitations asserted but not computed; open items implied as adjustments | FIXED — skill separates "Other Items to Review" from proposed adjustments |
| UX/designer | /assistant workspace dropped the host left nav → read as a separate chatbot (violated §4.2) | FIXED — shared WorkbenchNav mounted in the workspace + app-shell header; "Assistant workspace" nav item active |
| Demo-narrative | Prompt-injection surfaced a raw Azure 400 + Microsoft support link instead of a contained refusal | FIXED — SessionError handler maps content-filter errors to a contained on-brand refusal |

### MAJORs (fixed)
- Dock too wide → narrowed to a true rail (~360–420px).
- Artifact canvas wasted ~25% on a file rail for 1–2 items → rail hidden for a single artifact (full-width body).

### Deferred minors/nits (non-blocking, tracked)
- Citation chips reuse brand-primary orange (m1); static "READY" labels (m3); document-list metadata/grouping (m4);
  M-1 cites the firm policy rather than specific IRC sections (LOW); M-1 lacks a taxable-income bottom-line total (model-thoroughness, LOW).

## Convergence re-review — VERDICTS
- **Tax-practitioner: CONVERGED (correct + credible).** All three BLOCKERs verified resolved; M-1 adjustments tax-correct; no fabricated citations; trial balance foots.
- **UX/designer: CONVERGED (high quality).** Workspace now reads as a surface of Tax Workbench; dock/canvas proportions acceptable; no remaining blockers or majors.
- **Demo-narrative:** BLOCKER (Azure 400) fixed in code (contained refusal).

**Outcome: the multi-persona panel converges on high quality (§9.3/§9.6 satisfied).**
Regression: break-it battery green across rounds 7, 8, 9 (15/15, 0 page errors).
