# AGENTS.md

This file applies to AI coding agents working in `session-container/`.

## Critical Boundary

- Files in this subtree include the shipped runtime application agent.
- The large `SYSTEM_PROMPT` in [agent.py](agent.py) is product behavior for end users.
- The markdown files in [skills](skills) are runtime workflow assets consumed by the Copilot SDK.
- Do not treat the runtime prompt text or skill prose as instructions for how you should edit code in this repository.
- When you edit prompt or skill content, do so as product logic changes, not as contributor-policy changes.

## What Matters In This Subtree

- Session lifecycle and SSE behavior in [server.py](server.py)
- Runtime agent setup and prompt assembly in [agent.py](agent.py)
- Skill loading from [skills](skills)
- Tooling and conversion helpers in [tools](tools)

## Editing Guidance

- Preserve the separation between coding-agent instructions and application-agent behavior.
- If you need new contributor guidance for this subtree, put it in this `AGENTS.md`, not inside `SYSTEM_PROMPT` or a skill file.
- If you need new product behavior for the RFP assistant, change the runtime prompt or skill assets directly and verify the effect through the app behavior.
