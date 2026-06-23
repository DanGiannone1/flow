# Polish review — iteration 2

Four lenses (blind) on `review/polish-2/screens`: **business = high-quality · UI/UX = high-quality ·
tax-domain = not-yet · correctness = not-yet.** Did not converge → fixes below → iteration 3.

Notably, two of the not-yet findings were **regressions introduced by iteration-1's own fixes** — caught
by the adversarial loop, which is the point.

## Findings + disposition

### Correctness (not-yet)
- **[major] UTF-8 decode corruption (regression)** — iter-1's `aiter_raw` + per-chunk `.decode()` could
  split a multi-byte char (em-dash, used throughout the seed) across chunks → replacement chars. →
  **FIXED**: incremental UTF-8 decoder in `session_manager.py`. Verified: streamed em-dash survives,
  0× U+FFFD.
- **[major] `inFlightRef` leak (regression)** — flag set before the `try`; a throw in the prelude would
  stick it `true` and block all future sends. → **FIXED**: flag + all logic moved inside try/finally.
- **[minor]** Stop not prompt during a silent model/tool phase (inherent SSE-proxy limitation); abort
  comment overstated ("stops *subsequent* tool calls"); redundant `state.isStreaming` vs ref check —
  logged, acceptable for POC.

### Tax-domain (not-yet)
- **[major] Form 8879 on a corporate (1120) engagement letter** — should be **Form 8879-CORP** (8879 is
  the individual-1040 e-file auth). Introduced by iter-1's letter enrichment. → **FIXED**.
- **[minor] CA Form 100 extended due** should be 2026-11-15 (CA's automatic 7-month extension), not
  10-15. → **FIXED**.

### UI/UX (high-quality — minors)
- Badges float on tall rows (`vertical-align: top`) → **FIXED** to `middle`.
- "OPEN REQUESTS" KPI wraps → **FIXED**: shortened to "Requests".
- Idle left-pane balance + monochrome-terracotta hierarchy → logged (low priority).

### Business (high-quality — minors; all deck refinements, applied to PITCH-NOTES)
- Disclose the gpt-5.4-vs-4.1 model delta; treat the cost figure as a call-count proxy until tokens are
  priced; narrate the persistence "NEW"-badge-drop as the refetch proof; frame scale economics as a
  projection, not measured. → **all added to `PITCH-NOTES.md`**.
- Missing upload-summarize / continuity screenshots → continuity is exercised live (`screenshots/explore`);
  upload-summarize screenshot deferred (needs a file-upload Playwright step).

Post-fix: e2e **13/13** (`review/polish-3/screens`); UTF-8 integrity verified.
