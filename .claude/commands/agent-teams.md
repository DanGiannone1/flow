---
name: agent-teams
description: Patterns and playbooks for running effective agent teams, subagents, and task coordination in Claude Code. Use when planning any multi-agent workflow.
---

# Agent Teams Playbook

Hard-won patterns for multi-agent work. The agents are powerful reasoners with subagent access -- give them a mission and constraints, not a script.

## When to Reach for a Team

```
Simple task         -> Just do it. One agent.
Focused delegation  -> Subagents (results return to your context)
Parallel + independent work -> Agent team (each gets own context)
Parallel + adversarial      -> Agent team with cross-validation
```

Default to the simplest option. A single agent with Explore subagents handles most tasks. Teams cost ~7x more tokens and add coordination overhead. Only escalate when parallel exploration or adversarial cross-checking justifies the cost.

---

## Principles

**Give perspectives, not checklists.** "You are a production engineer -- what will break first?" beats "Check files A, B, C for issues X, Y, Z." Agents with a role and lens self-direct better than agents with a todo list.

**Cite or it's a hunch.** Require exact `file:line` citations. Findings without them are speculation. Agents should label unverified intuitions as "HUNCH" and state them separately.

**Trust agent reasoning.** Each team agent has subagent access and a powerful model. Describe the mission and what good output looks like. Don't micromanage how they investigate.

**Always synthesize.** Raw findings from N agents are noisy with duplicates and false positives. A synthesis step -- one agent that re-reads every cited line and verifies independently -- is what separates useful output from a wall of claims.

**Separate discovery from implementation.** Review agents should not also fix what they find. The bias toward confirming their own work is real. Discover first, then fix in a separate pass.

**Structure beats quantity.** An unstructured "bag of agents" amplifies errors at ~17x the expected rate. 4 agents with a clear topology beats 8 agents thrown at a problem. Fan-out/synthesize, pipeline with gates, or adversarial debate -- pick a shape.

---

## Patterns

### Deep Review

Give each agent a distinct perspective on the same codebase. They explore independently, then a synthesizer verifies everything.

**What makes it work:** Diverse perspectives surface different issues. A production engineer sees failure modes a product engineer misses, and vice versa. The synthesizer catches false positives from any individual.

**Perspectives that worked well for us:**
- Skeptical production engineer (failure modes, observability, resource exhaustion)
- New developer inheriting the codebase (confusion, dead code, inconsistencies)
- Penetration tester (trace every external input through the code)
- Product engineer (walk every user journey, find where the UX breaks)

**The one constraint that matters:** Reviewers run in parallel, synthesizer is blocked until they all finish. Everything else -- what to read, how many subagents to use, how deep to go -- is up to the agent.

### Parallel Fix

Multiple agents each own an independent fix or area. A validator reviews all changes after they finish.

**Hard lessons:**
- Worktree changes are LOST on TeamDelete -- merge before cleanup
- Fix agents must read current code first. We lost an entire review cycle because agents "fixed" things that were already fixed.
- The validator once caught a credential type change that would have broken production. This step is not optional.

### Consensus Vote

N agents independently read the same code and vote YES/NO/MODIFY on proposed changes. Majority rules. Disagreements surface real ambiguity.

**When we ran this:** 4 of 5 reviewers found that 10 of 12 "proposed fixes" were already in the codebase. The consensus pattern was the cheapest way to avoid wasting time implementing nothing.

### Competing Hypotheses

Each agent investigates a different theory. They challenge each other's reasoning. The hypothesis that survives cross-examination is most likely correct.

**Why it works:** Sequential investigation suffers from anchoring bias. Parallel adversarial investigation avoids it.

---

## Anti-Patterns

**Explore agents pattern-match, they don't read.** They see "CORS setup" and report "insecure" without reading the conditional logic. Never act on explore-only findings without verification.

**Category-scoped agents produce volume over depth.** "Find all bugs" gets you 15 findings at 60% accuracy. A perspective gets you 5 findings at 95%.

**Agents can't self-judge completeness.** Without guidance on expected depth, they either stop too early or explore irrelevantly. Give a sense of scale: "this is a thorough review, use subagents freely" vs "quick check, focused on this one area."

**Decision propagation amplifies errors.** When Agent A's wrong conclusion becomes Agent B's assumption, 10 downstream decisions are built on it. The synthesizer must verify independently -- never trust findings just because another agent produced them.

**Too many agents = diminishing returns.** Performance saturates around 4-5 agents. Beyond that, coordination overhead and duplicate findings outweigh parallelism.

---

## Task Dependencies

The one structural pattern to always use:

```
Tasks 1-N:  Independent work (parallel)
Task N+1:   Synthesis/validation (blocked by 1-N)
```

This ensures the synthesis agent sees the complete picture. Everything else about task design -- granularity, ownership, discovery of new tasks -- should be left to the agents to figure out based on the work.

---

## Quick Reference

| Scenario | Pattern | Team size |
|----------|---------|-----------|
| Pre-production review | Deep Review | 4 perspectives + synthesizer |
| Implement N fixes | Parallel Fix (worktrees) | N fixers + validator |
| Validate proposed changes | Consensus Vote | 3-5 voters |
| Debug / root cause | Competing Hypotheses | 3-5 investigators |
| Focused research | Single subagent | 1 |
