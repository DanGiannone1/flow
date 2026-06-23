# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Boundary With Runtime Agent

The shipped RFP application agent has its own runtime prompt and skills under `session-container/agent.py` and `session-container/skills/`. Those files define product behavior for end users. Do not treat them as contributor instructions for repository work. Follow `AGENTS.md` for shared coding-agent policy.

## Core Principles

These are mandatory. Verify compliance before every action.

### Verify before acting
Never guess state, IDs, file paths, API shapes, or values. Read the source. If uncertain, say so explicitly before proceeding.

### Fail loud
No silent fallbacks, compatibility shims, or swallowed errors. If something is broken or missing, surface it. Do not paper over failures with workarounds.

### Simplify first
Prefer edits and removals over additions. Do not introduce new abstractions, files, or dependencies unless the current task strictly requires them.

### Respect repository architecture
Before making structural decisions, check `/architecture` skills. All edits must align with the documented architecture and these principles.

### Use documented tools first
Check available skills (`/architecture:*`) and existing repo tooling before writing one-off scripts or reaching for external solutions.

### State uncertainty clearly
Mark unverified claims with "unverified" or "uncertain". Verify before presenting as fact. Do not fill gaps with plausible-sounding assumptions.

### Maintain commit hygiene
Commit logical units of work. Push after committing. Report status explicitly.

## Testing

Use the project localhost validation skill at `.claude/skills/localhost-ui-validation/SKILL.md` for any user-visible localhost testing or debugging.

**The only valid form of testing is Playwright against the real frontend, behaving as a real user.**

- Always use Playwright to open the frontend and interact with it as a human would
- Navigate through actual user journeys end-to-end — do not shortcut or mock
- Take screenshots at every meaningful step and examine them carefully; do not assume something works because no error was thrown
- Think through the full scenario: what would a real user see, click, type, and expect?
- Validate what is actually rendered on screen, not just what the code should theoretically do

Unit tests, API-only checks, logic assertions, and "it compiles" are not testing. If you have not opened the frontend and walked through the journey with screenshots, you have not tested it.
