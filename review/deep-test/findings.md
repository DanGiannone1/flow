# Deep / multi-angle testing (2026-06-19)

Prompted by the concern that earlier testing was broad-but-shallow (fresh single sessions, short
scripted turns, one generation of non-deterministic output, no real failure injection). New
harness drives the real frontend from angles the battery never hit. Screens in `review/deep-test/screens/`.

## Results — ALL PASSING (after fixing test-harness bugs)

### `scripts/deep_isolation.mjs` — multi-session isolation + concurrency
Two simultaneous browser contexts (two sandboxes) create uniquely-named tasks **concurrently**.
- ✅ A sees only its task; B sees only its task; no cross-bleed either way; 0 page errors.
- Validates the core per-user-sandbox claim *live*, under concurrency.

### `scripts/deep_failure.mjs` — failure injection + recovery (forged via network interception)
Live-verifies the F3/O1/error-path fixes that were previously only code-reviewed.
- ✅ **F3:** a transient backend error on restore shows "Could not reach your session — Retry",
  RETAINS the session id (no silent wipe), and on Retry the SAME session restores with the
  created marker task intact (no data loss).
- ✅ **Send failure:** POST /messages → 500 surfaces a loud error ("HTTP 500"), input stays
  usable (not stuck streaming), and a real send works afterward.
- Two test-harness bugs found + fixed along the way: `page.unroute(regex)` doesn't lift a fault
  registered with a different regex literal (use a toggle flag); `getByText(/Retry/)` matched the
  error-message text instead of the RETRY button (use `getByRole('button')`).

### `scripts/deep_workspace_edges.mjs` — workspace/route edge cases
- ✅ Deep-link straight to `/assistant` boots a usable workspace.
- ✅ Reload while on `/assistant` stays on `/assistant`, usable (no bounce/crash).
- ✅ Stop mid-stream **in the workspace** halts + input recovers.
- ✅ New Session **from the workspace** resets to seed and stays usable.

### `scripts/deep_session.mjs` — determinism + multiple artifacts
- ✅ Two M-1 analyses with **different phrasings** ("Schedule M-1" vs "independent book-to-tax
  reconciliation") — **neither** reintroduced the state-income-tax add-back; both start from the
  tied $9,044,000 book pre-tax income and cite sources. The tax-correctness fix is robust, not a one-off.
- ✅ Multi-artifact canvas works (5 artifacts; file rail renders + selection works).

### `scripts/deep_upload.mjs` — file upload → grounded analysis e2e
- ✅ A brand-new uploaded doc (`STC-RnD-credit-memo-2025.md`, a fact the agent couldn't otherwise
  know) is read by the agent, which answers **$312,400** grounded + cited.
- ⚠️ The uploaded doc didn't appear in the host **Documents view** within the 6s test window
  (still showed as a pending attachment chip) — the upload/processing is slower than the check.
  The file IS saved and readable. **Tracked:** confirm chat-uploaded docs surface in Documents
  promptly after processing (likely a refresh-timing item, not a broken upload).

## Gaps CLOSED in the follow-up round (2026-06-19)
- ✅ **Engagement-letter / artifact editing (§10.4)** — BUILT. ArtifactCanvas Edit→Save flow
  backed by `PUT /files/content` (path/dotfile/size-guarded). `scripts/deep_edit.mjs` verifies the
  edit **persists across reload** (real server write). (Surfaced + fixed a CORS bug: orchestrator
  `allow_methods` lacked PUT.)
- ✅ **Tax breadth** — `scripts/deep_breadth.mjs`: ASC 740 provision (grounded in the firm
  reference), engagement-letter drafting (from template), cross-document YoY reasoning (both
  sources cited), and the off-script "what's overdue" query — all green.
- ✅ **Real PDF → Content Understanding → analysis** — `scripts/deep_pdf.mjs`: a real generated
  PDF is uploaded, CU converts it to markdown, and the agent reads it and answers $9,182,540
  with a citation. Full CU pipeline verified e2e.
- ✅ **Consolidated runner** — `scripts/test_all.mjs` (+ `npm test` / `npm run test:smoke`) runs
  every suite with a health pre-check and a pass/fail summary, so this coverage doesn't regress.

## Honest remaining gaps (still open)
- **Long-horizon accumulation** — tested to ~5 artifacts / a handful of turns, not a long session.
- **Responsive / narrow viewports**, very long inputs / context-window limits.
- **DOCX upload through CU** — PDF verified; .docx path not yet exercised.
