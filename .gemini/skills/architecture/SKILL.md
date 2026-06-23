---
name: architecture
description: RFP Agent system architecture reference. Use when working on any part of the codebase, debugging cross-tier issues, or understanding how components connect.
---

# RFP Agent Architecture Reference

Three-tier system: **Frontend → Orchestrator → Session Container → Azure OpenAI**

The orchestrator never runs the Copilot SDK directly. It proxies SSE streams from isolated session containers to the frontend. Sessions are tracked in-memory only — no persistence layer.

## Architecture Sub-domains

Read the following reference files for specific areas of the architecture:

- **[overview.instructions.md](references/overview.instructions.md)**: System diagram, tiers, local vs production differences.
- **[sse-flow.instructions.md](references/sse-flow.instructions.md)**: AG-UI protocol, event types, how events flow end-to-end.
- **[document-processing.instructions.md](references/document-processing.instructions.md)**: Upload pipeline, Content Understanding, ADLS.
- **[knowledge-base.instructions.md](references/knowledge-base.instructions.md)**: Foundry IQ / Azure AI Search, setup, MCP integration.
- **[session-lifecycle.instructions.md](references/session-lifecycle.instructions.md)**: Session IDs, create/validate/delete, auth token forwarding.
- **[dev-setup.instructions.md](references/dev-setup.instructions.md)**: Prerequisites, dev commands, env vars, Playwright tests.
- **[deployment.instructions.md](references/deployment.instructions.md)**: Azure resources, ACR build commands, container updates.

Read the appropriate reference file(s) when working on these specific parts of the codebase.
