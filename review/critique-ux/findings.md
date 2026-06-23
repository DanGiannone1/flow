# Capabilities + UX critique (the axis evaluators actually use) — vs claude.ai OOTB

Re-framed panel (NOT tax-accuracy): a product/UX lead, an applied-AI capabilities lead, and a
skeptical enterprise buyer, all live-probing and comparing the *experience + capabilities* to
claude.ai out-of-the-box.

## Verdicts
- **Product/UX: YES (no blockers).** The live-acting model + honest trace + polish clearly beat a
  bolted-on chatbot as a demonstration of the embedded-assistant paradigm.
- **AI-capabilities: YES, narrowly.** Verifiable execution on live app state + grounded scoped
  retrieval are real, structurally-claude.ai-can't differentiators.
- **Buyer: NEEDS MORE.** Bones right; substance (real grounding/citations, durability) thin.

## Genuine differentiators (verified, real — claude.ai can't do these OOTB)
1. **Acts on live app state with server-rendered verification** — navigates, creates tasks/IRs
   that persist and re-render in the work plan; chains tools (create 1120 task → list overdue →
   pane shows the OVERDUE badge). "The agent claims = the record exists" identity holds, with
   honest NOT_FOUND/AMBIGUOUS handling. *The* strongest, most demo-able win.
2. **Grounded retrieval over pre-loaded firm data with honest scoping** (PBC outstanding-only).
3. **Honest, fail-closed live trace** (never a false green check) + honest per-turn meta.

## Fixed in this round (capabilities/UX axis)
| # | Finding (who) | Fix | Verified |
|---|---|---|---|
| 1 | **"Grounded in your data / RAG" oversold + backed by dead RFP-ancestor config** (buyer BLOCKER) — mcp.json `tax-knowledge`, .env.example pointing at non-existent scripts, unused AZURE_SEARCH_* | Deleted mcp.json; rewrote .env.example to state the real tool-based grounding honestly | ✅ committed |
| 2 | **Artifact loop EJECTS you** (UX MAJOR — the #1 UX wound): drafting from the `/assistant` workspace yanked you back to the host showing a read-only source template, not your deliverable | Scoped the workspace eject to genuine host-context nav (work-areas/dashboard/clients) only; deep-work/artifact routes (M-1/templates/documents) keep you in the workspace, deliverable in the canvas | ✅ drafting now stays in workspace; canvas shows the letter |
| 3 | **No scope identity** (UX MINOR) — answered "capital of France", wrote Python | System-prompt scope nudge: redirect clearly off-topic asks to the tax work | ✅ now: "I'm focused on your tax engagements…" |
| 4 | **`agent-working` thinking indicator had no animation** (UX MINOR) — collapsed launcher showed no activity | Added an `agent-working-pulse` keyframe (ambient pulse on the assistant icon/launcher while streaming) | ✅ CSS in place |

## Recommended next (bigger; scope before building)
- **Citation chips open the source** (buyer #1 leverage + capabilities + tax): make `[S1]` open the
  cited document (ideally the cited line). Turns "verifiable execution" from styled filename into
  real, click-to-verify provenance — the single change that most flips a skeptic.
- **Code-side compute validation** (capabilities BLOCKER + tax panel, both axes): `compute_tax`
  should derive/validate each M-1 add-back against structured firm policy (meals 50%, fines 100%,
  state-tax-not-added) and reject contradictions — converting "the engine decided this number" from
  a prompt promise into an enforced property. Reviewers reproduced a fabricated "2024 Tax Relief
  Act" 20% meals add-back baked into a persisted worksheet; this closes it.
- **Durable persistence** (all): per-engagement store so created records/artifacts survive session
  cooldown (today they evaporate) — the "manages your real work" promise.
- **Navigation robustness** (buyer): "take me to the STC federal compliance work area" → NOT_FOUND;
  harden `resolve_destination` for natural phrasing (demo papercut).
- Smaller UX polish: dock width transition + persisted dock state; render the M-1 worksheet inside
  the workspace canvas; loading skeletons; `:focus-visible` rings.