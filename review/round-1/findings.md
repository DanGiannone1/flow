# Review — Round 1

Screens: `review/round-1/screens/01..09`. Four adversarial lenses (UX/visual, usability,
demo-narrative, architecture/code), each blind to others. **All four returned `not-yet`.**

## Findings (synthesized, deduped)

### Blocking
- **Trace falsely shows "Navigated ✓" on an ambiguous/no-op navigation** (screenshot 04). Flagged by
  usability, demo-narrative, and architecture lenses independently. Frontend labeled steps by tool name
  + done-status and never saw the tool *outcome*, so any non-success result (ambiguous nav, not-found,
  `update_task` no-op) rendered as a green success — directly contradicting the verifiable-execution
  thesis (criteria §C).

### Major
- App pane under-filled on work-area screens (short table stranded at top of a wide pane). (UX)
- No visual signal when the app pane changes on agent navigation. (usability)
- Newly created rows indistinguishable from seeded rows. (usability)
- Not obvious the app nav is human-clickable. (usability)
- `taxdb.py` docstring said "will be reworked to Cosmos" — contradicts the no-DB decision. (arch)
- `GlassPanel.tsx` comment "Meridian design system" — leftover branding. (arch)
- Dead `report_intent` in `_HIDDEN_TOOLS`; unused `turn_read_paths` threaded through agent. (arch)

### Minor
- Single-step trace over-chromed ("EXECUTION LOG (1)" box, terminal icon) — reads as debug console.
- Skill-load step leaked raw plumbing as a co-equal success step.
- Short assistant replies floated in oversized bubbles.
- `navigate` could resolve `/clients` with no rendered view → silently showed Dashboard.
- Dead `chat.py` (0.x import + RFP text); `content_processing.py` "RFP content" string.

Confirmed OK by reviewers: the §C render-only-from-/app/state invariant holds; SDK 1.0.1 usage is
clean; latest-template picks v3.2 correctly; bulk create produced exactly 3 rows; persistence holds.

## Fixes applied (→ round 2)
- **Trace fidelity:** agent now emits a `TOOL_CALL_RESULT` (ok/noop/error) derived from the tool's
  result markers; frontend renders distinct states (e.g. "Needs clarification" for ambiguous nav) with
  outcome-specific icons. No green success unless the tool actually succeeded.
- Rewrote the trace as lightweight inline Claude-style steps (no "Execution Log" box); skill-load steps
  subordinated (muted).
- New task/IR rows highlight + show a "NEW" badge on the refetch after creation.
- Added a `/clients` screen + "All clients" nav; capped `.tw-screen` width to reduce stranding.
- Docstring/comment de-brand (taxdb, GlassPanel, content_processing); deleted dead `chat.py`; removed
  `report_intent`/`turn_read_paths` dead code.
