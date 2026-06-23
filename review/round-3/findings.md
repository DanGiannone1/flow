# Review — Round 3

Screens: `review/round-3/screens/01..09`. Four fresh adversarial lenses, blind to prior rounds.
Verdicts: **UX = not-yet · usability = not-yet · demo-narrative = not-yet · architecture = high-quality.**
(Did not converge → round 4.)

## Findings (synthesized)

### Blocking (single shared root cause — caught only by the live runs)
- **Tool-outcome classifier was inert at runtime → every result rendered as green "ok".**
  `ToolExecutionCompleteData.result` is a `ToolExecutionCompleteResult` **object** (carrying the tool
  string under `.content`), not a `str`/`dict`. My round-2 `_result_text` only handled str/dict, so it
  fell through to `repr()`, the leading token became the class name, and `_tool_outcome` returned `ok`
  for everything — including AMBIGUOUS navigation (shown as a false green "Navigated") and would have
  shown NOT_FOUND as success too. Because `_nav_candidates` used the same broken extractor, the
  one-click disambiguation **chips never rendered** either. (UX, usability, demo-narrative — all three
  blockers trace to this one bug. Architecture rated high-quality from reading the code, assuming
  `_result_text` worked — only live runs exposed it.)

### Major
- **"1 agent loop" in the per-turn meta was a hardcoded literal** — a fabricated structural number that
  undercut the efficiency-honesty claim. (demo-narrative)

### Minor
- `_nav_candidates` split on the literal word "and" (would fragment titles like "Research and
  Development"). (architecture)
- `tracing.py` OTEL service names still defaulted to `tax-agent*`. (architecture)
- Dead `IntakeState` type; `sessionStorage` keys still `rfp_agent_*`. (architecture)
- "In progress" badge used a terracotta/amber tone that reads as an alert. (UX)
- Sticky `newRecordIds`; initial `/app/state` load failure not surfaced. (architecture — minor)

## Fixes applied (→ round 4)
- **`_result_text` now extracts `.content`/`.detailed_content` from the typed result object** (and
  dicts), so leading-token classification reads the real marker. Verified live: ambiguous nav →
  `outcome:"noop"` + `candidates:[...]`; screenshot 04 now shows "Needs clarification" + two clickable
  chips, never a green "Navigated". Fixes both blockers at once.
- Removed the hardcoded "1 agent loop" — meta now reads honest "N tool calls · X.Xs".
- `_nav_candidates` splits on ";" only; `tracing.py` + `session.ts` keys de-branded; dead `IntakeState`
  removed; "In progress" badge recolored to a calm steel blue.
- e2e 11/11.
