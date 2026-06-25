# GEMINI.md

This file provides foundational guidance and mandates for Gemini CLI when working with code in this repository.

## Boundary With Runtime Agent

The shipped Personal Assistant application agent has its own runtime prompt and skills under `session-container/agent.py` and `session-container/skills/`. Those files define product behavior for end users. Do not treat them as contributor instructions for repository work. Follow `AGENTS.md` for shared coding-agent policy.

## Core Principles

These are mandatory. Verify compliance before every action.

### Verify before acting
Never guess state, IDs, file paths, API shapes, or values. Read the source. If uncertain, say so explicitly before proceeding.

### Fail loud
No silent fallbacks, compatibility shims, or swallowed errors. If something is broken or missing, surface it. Do not paper over failures with workarounds.

### Simplify first
Prefer edits and removals over additions. Do not introduce new abstractions, files, or dependencies unless the current task strictly requires them.

### Respect repository architecture
Before making structural decisions, check the architecture instructions (located in `.gemini/instructions/architecture` or `.github/instructions/architecture`). All edits must align with the documented architecture and these principles.

### Use documented tools first
Check available skills and existing repo tooling before writing one-off scripts or reaching for external solutions.

### State uncertainty clearly
Mark unverified claims with "unverified" or "uncertain". Verify before presenting as fact. Do not fill gaps with plausible-sounding assumptions.

### Maintain commit hygiene
Commit logical units of work. Push after committing. Report status explicitly.

## Gemini CLI & Google Antigravity Best Practices

This repository utilizes both **Gemini CLI** (terminal-based agent) and **Google Antigravity** (agent-first IDE). Use them according to their strengths:

1. **Use Gemini CLI for "Vibe Coding" and Quick Tasks:**
   - Best for terminal/shell-heavy tasks, system administration, and rapid parallelization of small tasks.
   - Use for "analyst" workflows (asking general questions, codebase investigation) to save Antigravity quota for heavy implementation.

2. **Use Google Antigravity for "Agentic Coding" and Heavy Lifting:**
   - Delegate complex, end-to-end features, multi-file refactors, and UI building to Antigravity.
   - Use Antigravity's **Browser Control** and visual **Artifacts** to verify agent work before committing changes.

3. **Intelligent Model Router:**
   - In Gemini CLI, ensure the **Intelligent Model Router** is enabled (`/settings`) so simple queries route to faster models (like Flash) and complex tasks route to Pro models.

4. **MCP (Model Context Protocol):**
   - Leverage MCP servers in both Gemini CLI and Antigravity to connect to external databases, documentation, or design agents (like Google Stitch).

5. **Workflow Separation:**
   - Use Gemini CLI for autonomous command-line execution and quick edits.
   - Use Antigravity for the "Manager View" to orchestrate multiple agents as employees across different repository domains.

## Testing

Use the project localhost validation skill at `.gemini/skills/localhost-ui-validation/SKILL.md` for any user-visible localhost testing or debugging.

**The primary valid form of testing is Playwright against the real frontend, behaving as a real user.**

- Always use Playwright to open the frontend and interact with it as a human would.
- Navigate through actual user journeys end-to-end — do not shortcut or mock.
- Validate what is actually rendered on screen, not just what the code should theoretically do.
- For complex visual testing and UI verifications, leverage **Antigravity Browser Control** to record and review the frontend state.
- Unit tests, API-only checks, and logic assertions alone are insufficient. If you have not verified the journey against the actual frontend, you have not tested it.
