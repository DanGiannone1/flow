# Pitch notes — how to present this POC

The running artifact proves the *architecture works and is honest*. It deliberately does **not**
fabricate comparison numbers in the UI (locked decision: no fake baseline on-screen). The commercial
contrast belongs in the deck/narration, backed by the real per-turn meta the app shows. Use these notes
so the business case lands instead of relying on hand-waving — this directly answers the
business-review findings.

## 1. Make the architectural contrast explicit (deck, not UI)
The app shows a true, measured per-turn meta: **"N tool calls · X.Xs"** (real wall-clock). Pair it on a
slide with the traditional planner/orchestrator baseline from the legacy system's traces:

| | Traditional planner/orchestrator (LangGraph-style) | This POC |
|---|---|---|
| Model calls for a navigation | ~8 (skill_match + write_plan + call_agent + NavigationAgent's normalize/embed/find_route/resolve) | 1 model turn + 1 tool call |
| Wall time (trace) | ~12.7s | shown live per turn |
| Layers reasoning over the request | 2 (orchestrator + sub-agent) | 1 |

Cite the legacy system's own trace files as the source of the ~8/~12.7s baseline —
it's a real measurement, not a strawman.

## 2. Lead with the cost lever (the slide finance cares about)
Fewer model calls = directly lower inference cost per interaction. Illustratively: ~1 call vs ~8 ≈
**~85% fewer LLM calls per simple action**. At thousands of preparers × seasonal peaks, that is the
number that moves a buying decision. (Quantify with real token counts before presenting.) Frame the
scale economics as a **projection**, not a demonstrated result — the POC runs a single local session, so
present per-interaction savings × headcount as modeled, not measured, until the ACA target is prototyped.

## 3. Attribute the latency honestly
The visible 3–8s is **model think-time**, not architecture overhead — the deterministic tool
(navigate/create) is ~instant. The architectural win is *fewer LLM round-trips*, not a faster single
call. Don't let "5.6s" read as the pitch; frame it as "one round-trip instead of eight."

**Disclose the model delta up front:** the baseline trace runs gpt-5.4 (a reasoning model, ~12.7s); this
POC runs gpt-4.1. Some of the latency gap is model choice, not architecture. State this plainly so a
sharp audience doesn't conflate the two — the durable, architecture-level claim is **fewer LLM
layers/round-trips**, which holds regardless of model.

**Token-cost figure is still a call-count proxy:** "~85% fewer calls" is solidly evidenced; the actual
$/navigation requires multiplying the trace's real token counts (write_plan 10,718→77, NavigationAgent
~6,638→102, etc.) by current gpt pricing. Compute that one real number before presenting; don't ship the
call-count ratio as a cost claim.

## 4. Show the governance/correctness moment (it's in the app — demo it)
The strongest regulated-domain differentiator is **verifiable execution**: the agent can only claim work
the tool actually did, and the pane renders solely from server state. Demo these live:
- **Fail-loud:** "take me to the crypto division" → "Destination not found" + closest options (the agent
  refuses rather than inventing). Screenshot `screenshots/poc/10-fail-loud-not-found.png`.
- **Ambiguity:** "go to compliance" → "Needs clarification" + candidate chips (no false navigation).
- **Persistence:** a created record survives reload (read from workspace state, not chat echo). The
  visible tell: after reload the "NEW" badges disappear while the row + count stay — proof the rows were
  refetched from `/app/state`, not echoed from the chat transcript.

## 5. Be honest about production scope (pre-empt the durability objection)
- State lives in the per-session workspace folder; **persistence is within a live session**, not durable
  production storage. Label screenshot 09 precisely.
- Production target: **ACA dynamic sessions** (ephemeral per-user sandboxes) + a durable external store
  (Blob for files, a document DB for records). One honest "production architecture" slide pre-empts the
  "how does this scale / where's the system of record" question.
- **Validated on real ACA (2026-06-17):** the session image was deployed to an ACA custom-container
  session pool; the per-session workspace state model worked unchanged — seed + agent-created records
  persisted across requests within a sandbox, and sandboxes are isolated per session id. Finding: ACA
  sandboxes have no IMDS, so the orchestrator's `X-Cogservices-Token` forwarding is required (the agent
  falls back to managed identity only when absent). See `review/aca-state-test.md`. State is still
  sandbox-ephemeral (destroyed on cooldown) — durable cross-session storage stays the deferred choice.

## 6. Steelman the baseline + scope the claim
Single-agent-with-tools is not novel; the win is **picking the right pattern for latency-sensitive,
in-app actions** rather than fanning out a planner for a one-agent job. Say explicitly where multi-agent
*is* warranted (long-horizon, multi-specialist reasoning) so the audience hears "we know where this
wins," not "we beat a strawman." Include a migration/coexistence note for an existing LangGraph system.

## 7. Prove general helpfulness (not just scripts)
Show one un-scripted, composed ask succeeding (e.g. "what's overdue in Federal Compliance?") so skills
read as capability, not a routing label. Evidence: `screenshots/poc/11-offscript-overdue.png`.
