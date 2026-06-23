# Review — Round 2

Screens: `review/round-2/screens/01..09`. Four fresh adversarial lenses, blind to round 1.
Verdicts: **usability = not-yet · UX = not-yet · demo-narrative = high-quality · architecture = not-yet.**
(Did not converge → round 3.)

The round-1 blocking fix was confirmed by all reviewers: the ambiguous navigation now shows
"Needs clarification", not a false green "Navigated."

## Findings (synthesized, deduped)

### Major
- **`_tool_outcome` scanned the whole result blob** (incl. document/template bodies) for marker
  substrings → a real success containing e.g. "NOT FOUND" could be misclassified. (arch, demo)
- **`TOOL_CALL_RESULT` fails open** — a lost outcome defaulted to green "ok" in the UI (the §C failure
  mode). (arch)
- **Dead code:** orphaned `tools/convert_document.py` (RFP-era MCP server) + unused `run_analysis`. (arch)
- **08 "trace panel" overclaims** — duplicate of 07; no timings/step-count/panel actually shown.
  (usability, UX; demo minor)
- **Vertical dead space** on work-area + landing screens → reads as a thin skeleton. (UX)
- **Nav not visibly clickable; no signal the pane changed; candidates not clickable.** (usability)

### Minor
- All seeded statuses were "Not started" → badge color system never appeared. (UX)
- NEW-badge placement awkward on info-request rows. (UX)
- Due-date column wrapped. (UX)
- Leftover "Meridian"/"RFP" comments in `globals.css` / `sse.ts`. (arch)
- README/evidence should explain the persistence proof (09). (demo)

## Fixes applied (→ round 3)
- `_tool_outcome` now classifies on the **leading status token + success flag only** (never scans
  content bodies). Fail-closed: a missing outcome renders **neutral "Done"**, never green success.
- Added per-turn **meta footer** (`N tool calls · 1 agent loop · X.Xs`) — makes single-tool-call
  efficiency concrete; renamed evidence `08-inline-step-trace` and corrected Section H wording (the
  inline trace IS the surface; no separate panel by design).
- **Clickable disambiguation chips**: navigate's ambiguous/​not-found candidates are surfaced to the UI
  as one-click chips (model-conditional — appears when the agent asks rather than self-resolving).
- **Dead space:** work-area summary stat strip + dashboard "Upcoming deadlines"; seeded varied task
  statuses (In progress / Complete / Not started) so badge colors show.
- **Pane-change pulse** on agent navigation; nav items get pointer affordance; NEW badge relocated;
  due-date `nowrap`.
- Deleted `convert_document.py` + `run_analysis`; de-branded `globals.css`/`sse.ts` comments.
- e2e adds checks for turn-meta + disambiguation; all green (11/11).
