# AGENTS.md

This file is for AI coding agents working on this repository.

It is not the runtime prompt for the shipped Personal Assistant application agent.

## Instruction Boundary

- Treat this file and any deeper `AGENTS.md` files as the coding-agent instruction layer.
- Do not treat the product runtime prompt or workflow skills as contributor instructions.
- The runtime prompt lives primarily in [session-container/agent.py](session-container/agent.py).
- The runtime skill assets live in [session-container/skills](session-container/skills).
- Those runtime files are application behavior. They tell the in-product assistant how to respond to end users. They do not tell you how to modify this codebase.
- If you edit runtime prompt or skill files, preserve this separation and keep coding-agent guidance in `AGENTS.md` only.

## Repository Map

- Root FastAPI orchestrator: [app.py](app.py)
- Session proxy and lifecycle: [session_manager.py](session_manager.py)
- Session container service: [session-container/server.py](session-container/server.py)
- Runtime application agent: [session-container/agent.py](session-container/agent.py)
- Frontend: [frontend/src](frontend/src)
- Document conversion: [content_processing.py](content_processing.py)
- End-to-end tests: [tests](tests)
- Architecture notes for humans and other agents:
  - [README.md](README.md)
  - [docs/user-journeys.md](docs/user-journeys.md)
  - [docs/tracing-spec.md](docs/tracing-spec.md)

## Core Rules

- Verify before acting. Read the source instead of inferring behavior.
- Fail loud. Do not hide broken state behind silent fallbacks unless the repo already does so intentionally.
- Simplify first. Prefer focused edits over adding new abstractions.
- Respect the existing architecture. The orchestrator does not run the Copilot SDK directly; agent execution lives in the session container.
- Do not add repo instructions to runtime prompt or skill files unless the product itself needs them.
- Do not move coding-agent rules into `CLAUDE.md`, `GEMINI.md`, or runtime prompt files only. Shared repository rules belong here.

## Workflow

- Start by reading the relevant code path end to end.
- For frontend/backend flows, trace the entire path before editing.
- Prefer `rg` and `rg --files` for search.
- Keep edits minimal and local to the problem.
- If you touch the runtime prompt or skill assets, verify that you are changing product behavior intentionally, not contributor policy accidentally.
- For user-visible localhost behavior, validate in the browser first, not just via API smoke tests.
- Browser validation must include screenshots and backend trace reconciliation for the same run.

## Localhost UI Validation

- For Codex, use the repo-local localhost validation skill at [.codex/skills/localhost-ui-validation/SKILL.md](.codex/skills/localhost-ui-validation/SKILL.md) when testing user-visible behavior.
- The shared/open-agent mirror of the same workflow is kept at [.agents/skills/localhost-ui-validation/SKILL.md](.agents/skills/localhost-ui-validation/SKILL.md).
- Use the browser-based Playwright flows under [tests](tests) as the default harness for localhost verification.
- Save screenshots under [screenshots](screenshots) and report the exact run directory.
- Tie the browser run to a concrete session by matching the uploaded filename and timestamps against [logs/trace.jsonl](logs/trace.jsonl) and the corresponding per-session raw log in [logs/sdk-events](logs/sdk-events).
- When reporting results, distinguish clearly between:
  - what the browser showed
  - what the shared trace showed
  - what the per-session raw SDK log showed
- API-only validation is acceptable as a secondary check, but it is not sufficient for UI behavior unless the user explicitly asks for API-only testing.

## Validation

- Root Python deps: `uv sync`
- Session container deps: `cd session-container && uv sync`
- Frontend deps: `cd frontend && npm install`
- Local stack: `uv run dev.py`
- Primary validation: `npx playwright test`
- Use targeted Playwright runs when narrowing scope, then run the smallest credible end-to-end verification for the changed path.
- Useful localhost UI entry points:
  - [tests/artifact_debug.spec.ts](tests/artifact_debug.spec.ts)
  - [tests/visual-verification.spec.ts](tests/visual-verification.spec.ts)
  - [tests/starter-prompts-ui.spec.ts](tests/starter-prompts-ui.spec.ts)

## Subtree Notes

- `session-container/` has its own `AGENTS.md` because that subtree contains the runtime application agent and prompt assets.
- `session-container/skills/` has its own `AGENTS.md` because those markdown files are consumed by the product agent at runtime.

## Runtime-Agent Reference

For the application-agent behavior spec, see [docs/application-agent-runtime.md](docs/application-agent-runtime.md). That document describes the shipped assistant behavior and should not be treated as coding-agent policy.
